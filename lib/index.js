var request = require('request-promise');
var pkg = require('../package');
var querystring = require('querystring');
var errors = require('request-promise/errors');
var urlUtil = require('url');
var tough = require('tough-cookie');

function buildFlattenedNameValueMap (obj) {
  if (!obj) {
    return [];
  }

  return Object.keys(obj).reduce((result, key) => {
    var value = obj[key];
    if (Array.isArray(value)) {
      return result.concat(value.map(v => ({
        name: key,
        value: v
      })));
    } else {
      return result.concat({
        name: key,
        value: value
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

function buildHarPostData (body) {
  return body ? {
    mimeType: 'application/json',
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

function buildHarContent (response, harConfig) {
  var { withContent = true } = harConfig;

  var harContent = {
    size: response && response.body && response.body.length || 0,
    mimeType: response && response.headers['content-type'] || 'x-unknown'
  };

  if (withContent && response && response.body) {
    harContent.text = response.body;
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
    headers: buildHarHeaders(request.headers),
    queryString: buildHarQuery(request.uri.query),
    postData: buildHarPostData(request.body),
    headersSize: -1,
    bodySize: -1
  };
}

function buildHarResponse (error, response, harConfig) {
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
    bodySize: -1
  };

  if (error) {
    harResponse._error = {
      message: error.message,
      code: error.code
    };
  }

  return harResponse;
}

function hrtimeToMilliseconds (hrtime) {
  var [ seconds, nanoseconds ] = hrtime;
  return seconds * 1000 + nanoseconds / 1000000;
}

function captureEntry (requestConfig, harConfig) {
  var { withRedirects = true } = harConfig;
  var startTime = Date.now();
  var startHrtime = process.hrtime();

  var options = Object.assign({}, requestConfig, {
    resolveWithFullResponse: true,
    simple: false,
    followRedirect: !withRedirects
  });
  var reqObject = request(options);
  var harRequest = buildHarRequest(reqObject);

  return reqObject
    .then(res => {
      return buildHarResponse(null, res, harConfig);
    }, error => {
      if (error instanceof errors.RequestError) {
        return buildHarResponse(error.cause, error.response, harConfig);
      } else {
        throw error;
      }
    })
    .then(harResponse => {
      var duration = hrtimeToMilliseconds(process.hrtime(startHrtime));

      return {
        startedDateTime: new Date(startTime).toISOString(),
        time: duration,
        request: harRequest,
        response: harResponse,
        cache: {},
        timings: {
          send: 0,
          receive: 0,
          wait: duration
        }
      };
    });
}

function shouldRedirect (entry, requestConfig, depth) {
  if (entry.response.status < 300 && entry.response.status >= 400) {
    return false;
  }

  if (!entry.response.redirectURL) {
    return false;
  }

  var {
    followRedirect = true,
    maxRedirects = 10
  } = requestConfig;

  if (!followRedirect) {
    return false;
  }

  if (depth >= maxRedirects) {
    entry.response._error = {
      message: 'Max redirects exceeded',
      code: 'MAXREDIRECTS'
    };
    return false;
  }

  return true;
}

function captureEntries (requestConfig, harConfig, depth = 1) {
  return captureEntry(requestConfig, harConfig)
    .then(entry => {
      if (shouldRedirect(entry, requestConfig, depth)) {
        var redirectConfig = Object.assign({}, requestConfig, {
          url: entry.response.redirectURL
        });
        return captureEntries(redirectConfig, harConfig, depth + 1)
          .then(entries => [ entry ].concat(entries));
      } else {
        return [ entry ];
      }
    });
}

function captureHar (requestConfig, harConfig = {}) {
  return captureEntries(requestConfig, harConfig)
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
