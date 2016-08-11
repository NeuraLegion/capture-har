/* global describe, it, afterEach */

var assert = require('chai').assert;
var captureHar = require('./captureHar');
var lolex = require('lolex');
var utils = require('./utils');
var urlUtil = require('url');

describe('captureHar', function () {
  afterEach(function () {
    if (this.clock) {
      this.clock.uninstall();
    }
    return utils.cleanMocks();
  });

  it('captures simple requests', function () {
    this.clock = lolex.install(1262304000000);
    return utils.mockServer(3000, (req, res) => {
      this.clock.tick(120);
      res.end('body');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].startedDateTime', '2010-01-01T00:00:00.000Z');
        assert.deepPropertyVal(har, 'log.entries[0].time', 120);

        assert.deepPropertyVal(har, 'log.entries[0].request.method', 'GET');
        assert.deepPropertyVal(har, 'log.entries[0].request.url', 'http://localhost:3000/');
        assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].name', 'host');
        assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].value', 'localhost:3000');

        assert.deepPropertyVal(har, 'log.entries[0].response.status', 200);
        assert.deepPropertyVal(har, 'log.entries[0].response.content.size', 4);
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.deepPropertyVal(har, 'log.entries[0].response.content.text', 'body');
      });
  });

  it('also accepts a url directly', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar('http://localhost:3000'))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.url', 'http://localhost:3000/');
      });
  });

  it('works with parsed url objects', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({ url: urlUtil.parse('http://localhost:3000') }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 200);
      });
  });

  it('passes on headers', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-test', 'response');
      // this test is for checking how handling duplicate headers works
      // node can only duplicate set-cookie headers
      res.setHeader('set-cookie', ['x', 'y']);
      res.end('hello');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        headers: {
          'host': 'www.google.com',
          'x-test': 'request'
        }
      }))
      .then(har => {
        assert.ok(har.log.entries[0].request.headers.find(header => {
          return header.name === 'host' && header.value === 'www.google.com';
        }), 'host request header');
        assert.ok(har.log.entries[0].request.headers.find(header => {
          return header.name === 'x-test' && header.value === 'request';
        }), 'x-test request header');

        assert.ok(har.log.entries[0].response.headers.find(header => {
          return header.name === 'content-type' && header.value === 'application/json';
        }), 'content-type response header');
        assert.ok(har.log.entries[0].response.headers.find(header => {
          return header.name === 'x-test' && header.value === 'response';
        }), 'host response header');
        assert.ok(har.log.entries[0].response.headers.find(header => {
          return header.name === 'set-cookie' && header.value === 'x';
        }), 'x-array response header');
        assert.ok(har.log.entries[0].response.headers.find(header => {
          return header.name === 'set-cookie' && header.value === 'y';
        }), 'x-array response header');

        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'application/json');
      });
  });

  it('parses querystring', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({ url: 'http://localhost:3000?param1=value1&param2=value2' }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[0].name', 'param1');
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[0].value', 'value1');
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[1].name', 'param2');
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[1].value', 'value2');
      });
  });

  it('handles request errors', function () {
    return captureHar({ url: 'http://x' })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.method', 'GET');
        assert.deepPropertyVal(har, 'log.entries[0].request.url', 'http://x/');

        assert.deepPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.deepPropertyVal(har, 'log.entries[0].response._error.code', 'ENOTFOUND');
        assert.deepPropertyVal(har, 'log.entries[0].response._error.message', 'getaddrinfo ENOTFOUND x x:80');
        assert.notDeepProperty(har, 'log.entries[0].response._error.stack');
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('handles status errors', function () {
    return utils.mockServer(3000, (req, res) => {
      res.statusCode = 404;
      res.end();
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 404);
      });
  });

  it('can ignore body content', function () {
    return utils.mockServer(3000, (req, res) => res.end('hello'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: false }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.content.size', 5);
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notDeepProperty(har, 'log.entries[0].response.content.text');
      });
  });

  it('normalizes methods', function () {
    return utils.mockServer(3000, (req, res) => res.end(req.method))
      .then(() => captureHar({
        method: 'post',
        url: 'http://localhost:3000'
      }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.method', 'POST');
        assert.deepPropertyVal(har, 'log.entries[0].response.content.text', 'POST');
      });
  });

  it('understands cookies', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('set-cookie', [
        'cookie3=value3; Domain=www.google.com; Path=/path; Expires=Fri, 01 Jan 2010 00:00:00 GMT; HttpOnly; Secure',
        'cookie4=value4'
      ]);
      res.end('hello');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        headers: {
          cookie: 'cookie1=value1; cookie2=value2'
        }
      }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.cookies[0].name', 'cookie1');
        assert.deepPropertyVal(har, 'log.entries[0].request.cookies[0].value', 'value1');
        assert.notDeepProperty(har, 'log.entries[0].request.cookies[0].path');
        assert.notDeepProperty(har, 'log.entries[0].request.cookies[0].domain');
        assert.notDeepProperty(har, 'log.entries[0].request.cookies[0].expires');
        assert.deepPropertyVal(har, 'log.entries[0].request.cookies[0].httpOnly', false);
        assert.deepPropertyVal(har, 'log.entries[0].request.cookies[0].secure', false);
        assert.deepPropertyVal(har, 'log.entries[0].request.cookies[1].name', 'cookie2');
        assert.deepPropertyVal(har, 'log.entries[0].request.cookies[1].value', 'value2');

        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].name', 'cookie3');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].value', 'value3');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].path', '/path');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].domain', 'www.google.com');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].expires', '2010-01-01T00:00:00.000Z');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].httpOnly', true);
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].secure', true);
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[1].name', 'cookie4');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[1].value', 'value4');
        assert.notDeepProperty(har, 'log.entries[0].response.cookies[1].path');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[1].httpOnly', false);
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[1].secure', false);
        assert.notDeepProperty(har, 'log.entries[0].response.cookies[1].domain');
      });
  });

  it.only('understands single set-cookie', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('set-cookie', 'cookie=value');
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].name', 'cookie');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].value', 'value');
      });
  });

  it('doesn\'t crash on invalid cookies', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('set-cookie', 'Secure; HttpOnly');
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.lengthOf(har.log.entries[0].response.cookies, 0);
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[0].value', 'Secure; HttpOnly');
      });
  });

  it('reads mime type properly', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'image/svg+xml');
      });
  });

  it('reads invalid mimetypes properly', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(200, { 'content-type': 'invalid' });
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });
});
