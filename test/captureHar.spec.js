/* global describe, it, afterEach */

var assert = require('chai').assert;
var captureHar = require('./captureHar');
var lolex = require('lolex');
var utils = require('./utils');
var urlUtil = require('url');
var dns = require('dns');

describe('captureHar', function () {
  afterEach(function () {
    if (this.clock) {
      this.clock.uninstall();
    }
    return utils.cleanMocks();
  });

  it('captures simple requests', function () {
    this.clock = lolex.install({ now: 1262304000000 });
    return utils.mockServer(3000, (req, res) => {
      this.clock.tick(120);
      res.end('body');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].startedDateTime', '2010-01-01T00:00:00.000Z');
        assert.nestedPropertyVal(har, 'log.entries[0].time', 120);

        assert.nestedPropertyVal(har, 'log.entries[0].request.method', 'GET');
        assert.nestedPropertyVal(har, 'log.entries[0].request.url', 'http://localhost:3000/');
        assert.nestedPropertyVal(har, 'log.entries[0].request.headers[0].name', 'host');
        assert.nestedPropertyVal(har, 'log.entries[0].request.headers[0].value', 'localhost:3000');

        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 200);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 4);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', 'body');
        assert.nestedPropertyVal(har, 'log.entries[0].response._remoteAddress', '127.0.0.1');
      });
  });

  it('also accepts a url directly', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar('http://localhost:3000'))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.url', 'http://localhost:3000/');
      });
  });

  it('works with parsed url objects', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({ url: urlUtil.parse('http://localhost:3000') }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 200);
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

        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'application/json');
      });
  });

  it('parses querystring', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({ url: 'http://localhost:3000?param1=value1&param2=value2' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.queryString[0].name', 'param1');
        assert.nestedPropertyVal(har, 'log.entries[0].request.queryString[0].value', 'value1');
        assert.nestedPropertyVal(har, 'log.entries[0].request.queryString[1].name', 'param2');
        assert.nestedPropertyVal(har, 'log.entries[0].request.queryString[1].value', 'value2');
      });
  });

  it('handles ENOTFOUND (DNS level error)', function () {
    return captureHar({ url: 'http://x' })
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.method', 'GET');
        assert.nestedPropertyVal(har, 'log.entries[0].request.url', 'http://x/');

        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'EAI_AGAIN');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'getaddrinfo EAI_AGAIN x');
        assert.notNestedPropertyVal(har, 'log.entries[0].response._error.stack');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('handles INVALID_URL error', function () {
    return utils.mockServer(3000, (req, res) => {
      res.socket.end([
        'HTTP/1.1 301 Moved Permanently',
        'Location: http://',
        '\r\n'
      ].join('\r\n'));
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'Invalid URL: http://');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'INVALID_REDIRECT_URL');
        assert.notNestedPropertyVal(har, 'log.entries[0].response._error.stack');
      });
  });

  it('handles ECONNRESET (TCP level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      req.socket.end();
    })
      .then(() => captureHar({
        url: 'http://localhost:3000'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'ECONNRESET');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'socket hang up');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('can timeout', function () {
    return utils.mockServer(3000, (req, res) => null)
      .then(() => captureHar({ url: 'http://localhost:3000', timeout: 100 }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'ETIMEDOUT');
      });
  });

  it('converts HTTP header values from ASCII to UTF-8 (to handle edge-cases)', function () {
    return Promise.all([
      utils.mockServer(3000, (req, res) => {
        res.socket.end([
          'HTTP/1.1 301 Moved Permanently',
          'Location: http://localhost:3001/fÖÖbÃÃr',
          '\r\n'
        ].join('\r\n'));
      }),
      utils.mockServer(3001, (req, res) => {
        res.end();
      })
    ])
      .then(() => captureHar({
        url: 'http://localhost:3000/bÃÃrfÖÖ'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.url', 'http://localhost:3000/bÃÃrfÖÖ');
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 301);
        assert.nestedPropertyVal(har, 'log.entries[0].response.headers[0].name', 'location');
        assert.nestedPropertyVal(har, 'log.entries[0].response.headers[0].value', 'http://localhost:3001/fÖÖbÃÃr');
        assert.nestedPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://localhost:3001/f%C3%96%C3%96b%C3%83%C3%83r');

        assert.nestedPropertyVal(har, 'log.entries[1].request.url', 'http://localhost:3001/f%C3%96%C3%96b%C3%83%C3%83r');
        assert.nestedPropertyVal(har, 'log.entries[1].response.status', 200);
      });
  });

  it('handles missing certificate (TLS level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello');
    }, 'https')
      .then(() => captureHar({
        url: 'https://localhost:3000'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'EPROTO');
        assert.nestedProperty(har, 'log.entries[0].response._error.message');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('handles invalid HTTP (HTTP parser level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      req.socket.end('invalid');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'HPE_INVALID_CONSTANT');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'Parse Error: Expected HTTP/');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('handles invalid HTTP (GZIP level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(
        200, {
          'content-encoding': 'gzip',
          'content-type': 'text/plain'
        }
      );
      res.end('invalid');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        gzip: true
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'Z_DATA_ERROR');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'incorrect header check');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('handles invalid JSON data (JSON level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(
        200, {
          'content-type': 'application/json'
        }
      );
      res.end('invalid');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        json: true
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 200);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'application/json');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', 'invalid');
      });
  });

  it('handles valid JSON data (JSON level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(
        200, {
          'content-type': 'application/json'
        }
      );
      res.end('{"hello":"world"}');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        json: true
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 200);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'application/json');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', '{"hello":"world"}');
      });
  });

  it('handles valid binary data (Buffer level error)', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(
        200, {
          'content-type': 'text/plain'
        }
      );
      res.end(Buffer.from([ 1, 2, 3, 4 ]));
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        encoding: null
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 200);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'text/plain');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 4);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', 'AQIDBA==');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.encoding', 'base64');
      });
  });

  it('handles HTTP version differences', function () {
    return utils.mockServer(3000, (req, res) => {
      req.socket.end('HTTP/0.9 200 OK\r\n\r\n');
    })
      .then(() => captureHar({
        url: 'http://localhost:3000',
        headers: {
          Host: 'localhost:3000'
        }
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.httpVersion', 'HTTP/1.1');

        assert.nestedPropertyVal(har, 'log.entries[0].response.httpVersion', 'HTTP/0.9');
      });
  });

  it('handles status errors', function () {
    return utils.mockServer(3000, (req, res) => {
      res.statusCode = 404;
      res.end();
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.status', 404);
      });
  });

  it('handles request body for plain text content', function () {
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({
        url: 'http://localhost:3000',
        body: 'test',
        headers: {
          'content-type': 'text/plain'
        }
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.postData.mimeType', 'text/plain');
        assert.nestedPropertyVal(har, 'log.entries[0].request.postData.text', 'test');
      });
  });

  it('handles request body for form-data content', function () {
    const formData = {
      key1: 'value1',
      key2: {
        value: Buffer.from('{}'),
        options: {
          filename: 'file1.json',
          contentType: 'application/json'
        }
      }
    };
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({
        url: 'http://localhost:3000',
        formData
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.postData.mimeType', 'multipart/form-data');
      });
  });


  it('handles request body for form content', function () {
    const form = {
      key1: 'value1',
      key2: 'value2'
    };
    return utils.mockServer(3000, (req, res) => res.end())
        .then(() => captureHar({
          url: 'http://localhost:3000',
          form
        }))
        .then(har => {
          assert.nestedPropertyVal(har, 'log.entries[0].request.postData.mimeType', 'application/x-www-form-urlencoded');
        });
  });

  it('shouldn\'t put the full body when captured with withContent: false', function () {
    return utils.mockServer(3000, (req, res) => res.end('hello'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: false }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 5);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('should calculate size based on byte size with body type: string, withContent: true', function () {
    return utils.mockServer(3000, (req, res) => res.end('ùùù'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: true, encoding: 'utf8' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 6);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', 'ùùù');
      });
  });

  it('should calculate size based on byte size with body type: buffer, withContent: true', function () {
    return utils.mockServer(3000, (req, res) => res.end('ùùù'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: true, encoding: null }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 6);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', 'ùùù');
      });
  });

  it('should calculate size based on byte size with body type: json, withContent: true', function () {
    return utils.mockServer(3000, (req, res) => res.end('{"ù":1}'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: true, json: true }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 8);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', '{"ù":1}');
      });
  });

  it('should calculate size based on byte size with body type: string, withContent: false', function () {
    return utils.mockServer(3000, (req, res) => res.end('ùùù'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: false, encoding: 'utf8' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 6);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('should calculate size based on byte size with body type: buffer, withContent: false', function () {
    return utils.mockServer(3000, (req, res) => res.end('ùùù'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: false, encoding: null }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 6);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('should calculate size based on byte size with body type: json, withContent: true', function () {
    return utils.mockServer(3000, (req, res) => res.end('{"ù":1}'))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: false, json: true }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 8);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('shouldn\'t truncate body when superior to maxContentLength and captured with withContent: false, maxContentLength: 4', function () {
    return utils.mockServer(3000, (req, res) => res.end(Buffer.alloc(6)))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { withContent: false, maxContentLength: 4 }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 6);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('should truncate body when superior to maxContentLength and captured with maxContentLength set', function () {
    return utils.mockServer(3000, (req, res) => res.end(Buffer.alloc(6)))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { maxContentLength: 4 }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'Maximum response size exceeded');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'MAX_RES_BODY_SIZE');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('shouldn\'t truncate body when inferior to maxContentLength and captured with maxContentLength set', function () {
    return utils.mockServer(3000, (req, res) => res.end(Buffer.alloc(2)))
      .then(() => captureHar({ url: 'http://localhost:3000' }, { maxContentLength: 4 }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 2);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.strictEqual(Buffer.from(har.log.entries[0].response.content.text, 'utf8').length, 2);
      });
  });

  it('should truncate when Content-Length superior to maxContentLength and captured with maxContentLength set', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('Content-Length', 6);
      res.end(Buffer.alloc(1));
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }, { maxContentLength: 4 }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.message', 'Maximum response size exceeded');
        assert.nestedPropertyVal(har, 'log.entries[0].response._error.code', 'MAX_RES_BODY_SIZE');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.content.text');
      });
  });

  it('shouldn\'t truncate when Content-Length inferior to maxContentLength and captured with maxContentLength set', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('Content-Length', 2);
      res.end(Buffer.alloc(1));
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }, { maxContentLength: 4 }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.size', 1);
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.strictEqual(Buffer.from(har.log.entries[0].response.content.text, 'utf8').length, 1);
      });
  });

  it('normalizes methods', function () {
    return utils.mockServer(3000, (req, res) => res.end(req.method))
      .then(() => captureHar({
        method: 'post',
        url: 'http://localhost:3000'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.method', 'POST');
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.text', 'POST');
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
        assert.nestedPropertyVal(har, 'log.entries[0].request.cookies[0].name', 'cookie1');
        assert.nestedPropertyVal(har, 'log.entries[0].request.cookies[0].value', 'value1');
        assert.notNestedPropertyVal(har, 'log.entries[0].request.cookies[0].path');
        assert.notNestedPropertyVal(har, 'log.entries[0].request.cookies[0].domain');
        assert.notNestedPropertyVal(har, 'log.entries[0].request.cookies[0].expires');
        assert.nestedPropertyVal(har, 'log.entries[0].request.cookies[0].httpOnly', false);
        assert.nestedPropertyVal(har, 'log.entries[0].request.cookies[0].secure', false);
        assert.nestedPropertyVal(har, 'log.entries[0].request.cookies[1].name', 'cookie2');
        assert.nestedPropertyVal(har, 'log.entries[0].request.cookies[1].value', 'value2');

        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].name', 'cookie3');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].value', 'value3');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].path', '/path');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].domain', 'www.google.com');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].expires', '2010-01-01T00:00:00.000Z');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].httpOnly', true);
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].secure', true);
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[1].name', 'cookie4');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[1].value', 'value4');
        assert.notNestedPropertyVal(har, 'log.entries[0].response.cookies[1].path');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[1].httpOnly', false);
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[1].secure', false);
        assert.notNestedPropertyVal(har, 'log.entries[0].response.cookies[1].domain');
      });
  });

  it('understands single set-cookie', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('set-cookie', 'cookie=value');
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].name', 'cookie');
        assert.nestedPropertyVal(har, 'log.entries[0].response.cookies[0].value', 'value');
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
        assert.nestedPropertyVal(har, 'log.entries[0].response.headers[0].value', 'Secure; HttpOnly');
      });
  });

  it('reads mime type properly', function () {
    return utils.mockServer(3000, (req, res) => {
      res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'image/svg+xml');
      });
  });

  it('reads invalid mimetypes properly', function () {
    return utils.mockServer(3000, (req, res) => {
      res.writeHead(200, { 'content-type': 'invalid' });
      res.end('hello');
    })
      .then(() => captureHar({ url: 'http://localhost:3000' }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
      });
  });

  it('passes through custom dns lookup', function () {
    var called = false;
    return utils.mockServer(3000, (req, res) => res.end())
      .then(() => captureHar({
        url: 'http://localhost:3000',
        lookup (host, options, cb) {
          called = true;
          return dns.lookup(host, options, cb);
        }
      }))
      .then(har => {
        assert.ok(called);
      });
  });

  it('normalizes url path if not specified', function () {
    return utils.mockServer(3000, (req, res) => {
      res.statusCode = 200;
      res.end();
    })
      .then(() => captureHar({
        url: 'http://127.0.0.1:3000'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.url', 'http://127.0.0.1:3000/');
      });
  });

  it('doesn\'t break when url host and host header value differ', function () {
    return utils.mockServer(3000, (req, res) => {
      res.statusCode = 200;
      res.end();
    })
      .then(() => captureHar({
        url: 'http://127.0.0.1:3000',
        headers: {
          Host: 'localhost:3000'
        }
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].request.url', 'http://127.0.0.1:3000/');
        assert.nestedPropertyVal(har, 'log.entries[0].request.headers[0].name', 'host');
        assert.nestedPropertyVal(har, 'log.entries[0].request.headers[0].value', 'localhost:3000');
      });
  });

  it('detects ip address when fetch by ip', function () {
    return utils.mockServer(3000, (req, res) => {
      res.statusCode = 200;
      res.end();
    })
      .then(() => captureHar({
        url: 'http://127.0.0.1:3000'
      }))
      .then(har => {
        assert.nestedPropertyVal(har, 'log.entries[0].response._remoteAddress', '127.0.0.1');
      });
  });
});
