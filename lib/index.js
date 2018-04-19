const through = require('through');
const urlUtil = require('url');
const net = require('net');
const dns = require('dns');
const pkg = require('../package');

const { buildHarEntry, buildHarConfig } = require('../helpers/buildHar');
const { parseRedirectUrl } = require('../helpers/parser');

function shouldRedirect (response, requestConfig, depth) {
  if (!response) {
    return [ false, null ];
  }

  if (response.statusCode < 300 || response.statusCode >= 400) {
    return [ false, null ];
  }

  const redirectUrl = parseRedirectUrl(response);
  if (!redirectUrl) {
    return [ false, {
      message: 'Missing location header',
      code: 'NOLOCATION'
    } ];
  }

  const {
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

function hrtimeToMilliseconds (hrtime) {
  var [ seconds, nanoseconds ] = hrtime;
  return seconds * 1000 + nanoseconds / 1000000;
}

function captureEntries ({ requestConfig, harConfig, depth, throughStream, requestModule, entries, dnsCache = {} }) {
  const reqOptions = Object.assign({}, requestConfig, {
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

  const startTime = Date.now();
  const startHrtime = process.hrtime();
  let reqObject;
  try {
    reqObject = requestModule(reqOptions, (error, response, body) => {
      if (net.isIP(reqObject.uri.hostname)) {
        dnsCache.remoteAddress = reqObject.uri.hostname;
      }

      const [ isRedirect, redirectError ] = shouldRedirect(response, requestConfig, depth);
      error = error || redirectError;
      const request = response && response.request || reqObject;
      const entry = buildHarEntry({ request, response, error, harConfig, meta: {
        startTime: startTime,
        duration: hrtimeToMilliseconds(process.hrtime(startHrtime)),
        remoteAddress: dnsCache.remoteAddress
      }});
      entries.push(entry);
      if (isRedirect) {
        const redirectConfig = Object.assign({}, requestConfig, {
          url: entry.response.redirectURL
        });
        const customHostHeaderName = getCustomHostHeaderName(requestConfig);
        if (customHostHeaderName) {
          const host = urlUtil.parse(entry.response.redirectURL).host;
          redirectConfig.headers[customHostHeaderName] = host;
        }
        captureEntries({
          requestConfig: redirectConfig,
          harConfig,
          depth: depth + 1,
          throughStream,
          requestModule,
          entries
        });
      } else {
        throughStream.end();
      }
    });
  } catch (error) {
    const entry = buildHarEntry({ error, harConfig, meta: {
      startTime: startTime,
      duration: hrtimeToMilliseconds(process.hrtime(startHrtime)),
      remoteAddress: dnsCache.remoteAddress
    }});
    entries.push(entry);
    return throughStream.end();
  }

  reqObject
    .on('data', data => {
      if (harConfig.withContent && Number.isFinite(harConfig.maxContentLength)) {
        var bufferLenght = 0;
        bufferLenght += data.length;

        if (bufferLenght > harConfig.maxContentLength) {
          reqObject.abort();
          var error = new RangeError('Maximum response size exceeded');
          error.code = 'MAX_RES_BODY_SIZE';
          reqObject.emit('error', error);
        }
      }
      throughStream.write(data);
    })
    .on('response', res => {
      if (!harConfig.withContent) {
        reqObject.end();
      } else if (parseInt(res.headers['content-length'], 10) > harConfig.maxContentLength) {
        reqObject.abort();
        var error = new RangeError('Maximum response size exceeded');
        error.code = 'MAX_RES_BODY_SIZE';
        reqObject.emit('error', error);
      }
    });
}

function CaptureHar (requestModule) {
  this.requestModule = requestModule;
  this.entries = [];
}

CaptureHar.prototype.start = function (requestConfig, harConfig = {}, depth = 1) {
  const throughStream = through(
    data => throughStream.emit('data', data),
    () => throughStream.emit('end')
  );

  captureEntries({
    requestConfig,
    harConfig: buildHarConfig(harConfig),
    depth,
    throughStream,
    requestModule: this.requestModule,
    entries: this.entries
  });

  return throughStream;
};

CaptureHar.prototype.stop = function () {
  return {
    log: {
      version: '1.2',
      creator: {
        name: pkg.name,
        version: pkg.version
      },
      entries: this.entries
    }
  };
};

module.exports = CaptureHar;
