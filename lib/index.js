var request = require('request-promise');
var pkg = require('../package');
var querystring = require('querystring');
var urlUtil = require('url');
var tough = require('tough-cookie');
var contentType = require('content-type');
var dns = require('dns');
var net = require('net');

function buildFlattenedNameValueMap (obj) {
  if (!obj) {
    return [];
  }

  return Object.keys(obj).reduce((result, key) => {
    var value = obj[key];
    if (Array.isArray(value)) {
      return result.concat(value.map(v => ({
        name: key,
        value: String(v)
      })));
    } else {
      return result.concat({
        name: key,
        value: String(value)
      });
    }
  }, []);
}

function buildHarHeaders (headers) {
  return buildFlattenedNameValueMap(headers);
}

function buildHarQuery (query) {
  return buildFlattenedNameValueMap(querystring.parse(query));
}

function buildHarPostData (body, request) {
  return body ? {
    mimeType: getMimeType(request),
    text: body
  } : undefined;
}

function parseHttpVersion (response) {
  var version = response && response.httpVersion || null;
  return version ? `HTTP/${version}` : 'unknown';
}

function parseRedirectUrl (response) {
  if (response && response.statusCode >= 300 && response.statusCode < 400) {
    var location = response.headers['location'];
    if (location) {
      var base = response.request.uri;
      return urlUtil.resolve(base, location);
    }
  }

  return '';
}

function getMimeType (response) {
  try {
    return contentType.parse(response).type;
  } catch (e) {
    return 'x-unknown';
  }
}

function buildHarContent (response, harConfig) {
  if (!response) {
    return { size: 0, mimeType: 'x-unknown' };
  }

  var { withContent = true } = harConfig;

  var harContent = {
    size: response.body && response.body.length || 0,
    mimeType: getMimeType(response)
  };

  if (withContent && response.body) {
    if (typeof response.body === 'string') {
      harContent.text = response.body;
    } else if (Buffer.isBuffer(response.body)) {
      harContent.text = response.body.toString('utf8');
    } else {
      harContent.text = JSON.stringify(response.body);
    }
  }

  return harContent;
}

function buildHarCookie (cookie) {
  var harCookie = {
    name: cookie.key,
    value: cookie.value,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure
  };

  if (cookie.path) {
    harCookie.path = cookie.path;
  }

  if (cookie.domain) {
    harCookie.domain = cookie.domain;
  }

  if (cookie.expires instanceof Date) {
    harCookie.expires = cookie.expires.toISOString();
  }

  return harCookie;
}

function buildHarCookies (cookies) {
  if (!cookies) {
    return [];
  }

  return cookies
    .map(tough.parse)
    .filter(cookie => cookie)
    .map(buildHarCookie);
}

function buildHarRequest (request) {
  return {
    method: request.method.toUpperCase(),
    url: request.uri.href,
    httpVersion: 'HTTP/1.1',
    cookies: buildHarCookies(request.headers.cookie && request.headers.cookie.split(';')),
    headers: buildHarHeaders(request.req && request.req._headers || request.headers),
    queryString: buildHarQuery(request.uri.query),
    postData: buildHarPostData(request.body, request),
    headersSize: -1,
    bodySize: -1
  };
}

function buildHarResponse (error, response, harConfig, meta) {
  var setCookieHeader = response && response.headers['set-cookie'];
  if (setCookieHeader && !Array.isArray(setCookieHeader)) {
    setCookieHeader = [ setCookieHeader ];
  }

  var harResponse = {
    status: response && response.statusCode || 0,
    statusText: response && response.statusMessage || '',
    httpVersion: parseHttpVersion(response),
    cookies: buildHarCookies(setCookieHeader),
    headers: buildHarHeaders(response && response.headers),
    content: buildHarContent(response, harConfig),
    redirectURL: parseRedirectUrl(response),
    headersSize: -1,
    bodySize: -1,
    _remoteAddress: meta.remoteAddress
  };

  if (error) {
    harResponse._error = {
      message: error.message,
      code: error.code
    };
  }

  return harResponse;
}

function buildHarEntry (request, error, response, harConfig, meta) {
  return {
    startedDateTime: new Date(meta.startTime).toISOString(),
    time: meta.duration,
    request: buildHarRequest(request),
    response: buildHarResponse(error, response, harConfig, meta),
    cache: {},
    timings: {
      send: 0,
      receive: 0,
      wait: meta.duration
    }
  };
}

function hrtimeToMilliseconds (hrtime) {
  var [ seconds, nanoseconds ] = hrtime;
  return seconds * 1000 + nanoseconds / 1000000;
}

function captureEntry (requestConfig, harConfig, dnsCache) {
  var options = Object.assign({}, requestConfig, {
    resolveWithFullResponse: true,
    simple: false,
    followRedirect: false,
    lookup (host, options, cb) {
      var lookupFn = requestConfig.lookup || dns.lookup;
      return lookupFn(host, options, (err, ip, addressType) => {
        dnsCache.remoteAddress = ip;
        cb(err, ip, addressType);
      });
    }
  });
  var reqObject = request(options);

  reqObject.on('response', function (res) {
    if (!harConfig.withContent) {
      this.end();
    } else if (parseInt(res.headers['content-length'], 10) > harConfig.truncateAfter) {
      this.abort();
      var error = new RangeError('Maximum response size exceeded');
      error.code = 'TRUNCATED';
      this.emit('error', error);
    }
  });

  if (harConfig.withContent && Number.isFinite(harConfig.truncateAfter)) {
    var bufferLenght = 0;

    reqObject.on('data', function (buffer) {
      bufferLenght += buffer.length;

      if (bufferLenght > harConfig.truncateAfter) {
        this.abort();
        var error = new RangeError('Maximum response size exceeded');
        error.code = 'TRUNCATED';
        this.emit('error', error);
      }
    });
  }

  if (net.isIP(reqObject.uri.hostname)) {
    dnsCache.remoteAddress = reqObject.uri.hostname;
  }

  return reqObject
    .then(response => {
      return [ reqObject, null, response, dnsCache.remoteAddress ];
    }, error => {
      return [ reqObject, error.cause, error.response, dnsCache.remoteAddress ];
    });
}

function shouldRedirect (response, requestConfig, depth) {
  if (!response) {
    return [ false, null ];
  }

  if (response.statusCode < 300 || response.statusCode >= 400) {
    return [ false, null ];
  }

  var redirectUrl = parseRedirectUrl(response);
  if (!redirectUrl) {
    return [ false, {
      message: 'Missing location header',
      code: 'NOLOCATION'
    } ];
  }

  var {
    followRedirect = true,
    maxRedirects = 10
  } = requestConfig;

  if (!followRedirect) {
    return [ false, null ];
  }

  if (typeof followRedirect === 'function') {
    return [ followRedirect(response), null ];
  }

  if (depth > maxRedirects) {
    return [ false, {
      message: 'Max redirects exceeded',
      code: 'MAXREDIRECTS'
    } ];
  }

  return [ true, null ];
}

function getCustomHostHeaderName (requestConfig) {
  if (!requestConfig.headers) {
    return null;
  }
  var headerName = Object.keys(requestConfig.headers).find(key => key.toLowerCase() === 'host');
  return headerName || null;
}

function captureEntries (requestConfig, harConfig, dnsCache = {}, depth = 1) {
  var startTime = Date.now();
  var startHrtime = process.hrtime();

  return captureEntry(requestConfig, harConfig, dnsCache)
    .then(([ request, error, response, remoteAddress ]) => {
      var [ isRedirect, redirectError ] = shouldRedirect(response, requestConfig, depth);
      error = error || redirectError;

      var req = response && response.request || request;
      var entry = buildHarEntry(req, error, response, harConfig, {
        startTime: startTime,
        duration: hrtimeToMilliseconds(process.hrtime(startHrtime)),
        remoteAddress: remoteAddress
      });
      startTime = Date.now();
      startHrtime = process.hrtime();

      if (isRedirect) {
        var redirectConfig = Object.assign({}, requestConfig, {
          url: entry.response.redirectURL
        });
        var customHostHeaderName = getCustomHostHeaderName(requestConfig);
        if (customHostHeaderName) {
          var host = urlUtil.parse(entry.response.redirectURL).host;
          redirectConfig.headers[customHostHeaderName] = host;
        }
        return captureEntries(redirectConfig, harConfig, dnsCache, depth + 1)
          .then(entries => [ entry ].concat(entries));
      } else {
        return [ entry ];
      }
    });
}

function buildHarConfig (harConfig) {
  return Object.assign(
    {},
    {
      withContent: true,
      truncateAfter: Infinity
    },
    harConfig
  );
}

function buildRequestConfig (requestConfig) {
  if (typeof requestConfig === 'string') {
    return { url: requestConfig };
  }
  return requestConfig;
}

function captureHar (requestConfig, harConfig = {}) {
  return captureEntries(
    buildRequestConfig(requestConfig),
    buildHarConfig(harConfig)
  )
    .then(entries => {
      return {
        log: {
          version: '1.2',
          creator: {
            name: pkg.name,
            version: pkg.version
          },
          entries: entries
        }
      };
    });
}

module.exports = captureHar;
