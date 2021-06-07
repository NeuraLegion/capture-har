const encodingUtil = require('./encoding-util');
const urlUtil = require('url');

function parseHttpVersion (response) {
  var version = response && response.httpVersion || null;
  return version ? `HTTP/${version}` : 'unknown';
}

function parseRedirectUrl (response) {
  if (response && response.statusCode >= 300 && response.statusCode < 400) {
    var location = encodingUtil.transformBinaryToUtf8(response.headers['location']);
    if (location) {
      var hasRelativeProtocol = location.startsWith('//');
      var isRelativeUrl = !hasRelativeProtocol && /^\.*\//.test(location);
      var base = response.request.uri;
      try {
        return [ null, isRelativeUrl ? new urlUtil.URL(location, base.href).href : new urlUtil.URL(location).href ];
      } catch (err) {
        return [ {
          message: err.message,
          code: 'INVALID_REDIRECT_URL'
        }, '' ];
      }
    }
  }

  return [ {
    message: 'Missing location header',
    code: 'NOLOCATION'
  }, '' ];
}

module.exports = {
  parseHttpVersion,
  parseRedirectUrl
};
