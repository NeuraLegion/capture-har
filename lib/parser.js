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
      var base = response.request.uri;
      return urlUtil.resolve(base, location);
    }
  }

  return '';
}

module.exports = {
  parseHttpVersion,
  parseRedirectUrl
};
