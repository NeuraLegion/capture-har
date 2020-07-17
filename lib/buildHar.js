const tough = require('tough-cookie');
const contentType = require('content-type');
const querystring = require('querystring');
const encodingUtil = require('./encoding-util');
const { parseHttpVersion } = require('./parser');

const BASE64_PATTERN = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/

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

function getMultipartContentType(param) {
  if (param && param.contentType) {
    return param.contentType
  }

  if (param.value.startsWith('{') && param.value.endsWith('}')) {
    return 'application/json'
  }

  if (BASE64_PATTERN.test(param.value)) {
    return 'application/octet-stream'
  }
}

function convertFormDataToText(value, boundary) {
  const EOL = '\r\n'

  let rawData = value
      .reduce((params, item) => {
        const multipartContentType = getMultipartContentType(item)

        let param = `--${boundary}${EOL}`

        param += `Content-Disposition: form-data; name="${item.name}"`

        if (multipartContentType) {
          param += `${EOL}Content-Type: ${multipartContentType}`
        }

        param += `${EOL + EOL}`
        param += typeof item.value === 'object' ? JSON.stringify(item.value) : item.value

        params.push(param)

        return params
      }, [])
      .join(EOL)
  rawData += EOL
  rawData += `--${boundary}--`
  return rawData
}

function convertFormData(name, param, params) {
  switch (typeof param) {
    case "object":
      if (Array.isArray(param)) {
        param.forEach((x) => params.push(convertFormData(name, x, params)))
      } else if (Buffer.isBuffer(param)) {
        params.push({name: name, value: param.toString('utf8')});
      } else if (param.options) {
        var value = Buffer.isBuffer(param.value) ?
            param.value.toString('utf8') :
            (param.value || '').toString();

        params.push({
          name: name,
          value: value,
          fileName: param.options.filename,
          contentType: param.options.contentType || getMimeType(value)
        });
      }
      break;
    default:
      params.push({
        name,
        value: (param || '').toString()
      });
  }
}

function buildHarPostData (request) {
  if (request.body) {
    return {
      mimeType: getMimeType(request),
      text: request.body
    }
  }
  if (request.formData) {
    var params = [];

    Object.keys(request.formData).forEach((name) => {
      var value = request.formData[name];
      convertFormData(name, value, params);
    })
    let header = request.getHeader('content-type');
    let boundary  = header.split(" ")[1]
    boundary = boundary.split("=")[1]
    return {
      mimeType: 'multipart/form-data',
      params: params,
      text: convertFormDataToText(params, boundary)
    }
  }
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
    postData: buildHarPostData(request),
    headersSize: -1,
    bodySize: -1
  };
}

function buildHarResponse ({ error, response = {}, harConfig, redirectUrl, meta }) {
  const setCookieHeader = response.headers && response.headers['set-cookie']
    ? Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie']
      : [ response.headers['set-cookie'] ]
    : [];

  const harResponse = {
    status: response.statusCode && !error ? response.statusCode : 0,
    statusText: response.statusMessage || '',
    httpVersion: parseHttpVersion(response),
    cookies: buildHarCookies(setCookieHeader),
    headers: buildHarHeaders(response.headers),
    content: buildHarContent(response, harConfig),
    redirectURL: redirectUrl,
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

function buildHarEntry ({ request, response, error, harConfig, redirectUrl, meta }) {
  return {
    startedDateTime: new Date(meta.startTime).toISOString(),
    time: meta.duration,
    request: buildHarRequest(request),
    response: buildHarResponse({ error, response, harConfig, redirectUrl, meta }),
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
