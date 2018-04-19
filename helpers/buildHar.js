const tough = require('tough-cookie');
const contentType = require('content-type');
const querystring = require('querystring');
const encodingUtil = require('../helpers/encoding-util');
const { parseHttpVersion, parseRedirectUrl } = require('./parser');

function buildFlattenedNameValueMap (obj) {
  if (!obj) {
    return [];
  }

  return Object.keys(obj).reduce((result, key) => {
    const value = obj[key];
    if (Array.isArray(value)) {
      return result.concat(value.map(v => ({
        name: key,
        value: encodingUtil.transformBinaryToUtf8(v)
      })));
    } else {
      return result.concat({
        name: key,
        value: encodingUtil.transformBinaryToUtf8(value)
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

  const { withContent = true } = harConfig;

  const harContent = {
    mimeType: getMimeType(response)
  };

  if (withContent && response.body) {
    if (typeof response.body === 'string') {
      harContent.text = response.body;
    } else if (Buffer.isBuffer(response.body)) {
      harContent.text = response.body.toString('base64');
      harContent.encoding = 'base64';
    } else {
      harContent.text = JSON.stringify(response.body);
      harContent.encoding = 'utf8';
    }
  }

  if (typeof response.body === 'string') {
    harContent.size = Buffer.byteLength(response.body);
  } else if (Buffer.isBuffer(response.body)) {
    harContent.size = response.body.length;
  } else if (harContent.text) {
    harContent.size = Buffer.byteLength(harContent.text);
  } else {
    harContent.size = 0;
  }

  return harContent;
}

function buildHarCookie (cookie) {
  const harCookie = {
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

function buildHarRequest (request = {}) {
  return {
    method: request.method && request.method.toUpperCase() || '',
    url: request.uri && request.uri.href || '',
    httpVersion: 'HTTP/1.1',
    cookies: buildHarCookies(request.headers && request.headers.cookie && request.headers.cookie.split(';')),
    headers: buildHarHeaders(request.req && request.req._headers || request.headers),
    queryString: buildHarQuery(request.uri && request.uri.query),
    postData: buildHarPostData(request.body, request),
    headersSize: -1,
    bodySize: -1
  };
}

function buildHarResponse ({ error, response = {}, harConfig, meta }) {
  const setCookieHeader = response.headers && response.headers['set-cookie']
    ? Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie']
      : [ response.headers['set-cookie'] ]
    : [];

  const harResponse = {
    status: response.statusCode || 0,
    statusText: response.statusMessage || '',
    httpVersion: parseHttpVersion(response),
    cookies: buildHarCookies(setCookieHeader),
    headers: buildHarHeaders(response.headers),
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

function buildHarConfig (harConfig) {
  return Object.assign(
    {},
    {
      withContent: true,
      maxContentLength: Infinity
    },
    harConfig
  );
}

function buildHarEntry ({ request, response, error, harConfig, meta }) {
  return {
    startedDateTime: new Date(meta.startTime).toISOString(),
    time: meta.duration,
    request: buildHarRequest(request),
    response: buildHarResponse({ error, response, harConfig, meta }),
    cache: {},
    timings: {
      send: 0,
      receive: 0,
      wait: meta.duration
    }
  };
}

module.exports = {
  buildHarEntry,
  buildHarConfig
};
