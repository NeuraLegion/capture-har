/* global describe, it, afterEach */

const assert = require('chai').assert;
const CaptureHar = require('../lib/index').CaptureHar;
const lolex = require('lolex');
const utils = require('./utils');
const net = require('net');
const request = require('request');

describe('redirectStream', () => {
  afterEach(() => {
    if (this.clock) {
      this.clock.uninstall();
    }
    return utils.cleanMocks();
  });

  it('handles invalid redirects', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000' })
          .on('end', () => {
            const har = captureHar.stop();
            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.lengthOf(har.log.entries, 1);
            assert.deepPropertyVal(har, 'log.entries[0].response._error.message', 'Missing location header');
            assert.deepPropertyVal(har, 'log.entries[0].response._error.code', 'NOLOCATION');
            done();
          });
      });
  });

  it('records redirects', done => {
    this.clock = lolex.install({ now: 1262304000000 });
    utils.mockServer(3000, (req, res) => {
      if (req.url === '/') {
        this.clock.tick(1000);
        res.statusCode = 301;
        res.setHeader('location', '/maps');
        res.end();
      } else if (req.url === '/maps') {
        this.clock.tick(2000);
        res.statusCode = 200;
        res.end('body');
      }
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000' })
          .on('end', () => {
            const har = captureHar.stop();

            assert.deepPropertyVal(har, 'log.entries[0].startedDateTime', '2010-01-01T00:00:00.000Z');
            assert.deepPropertyVal(har, 'log.entries[0].time', 1000);

            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://localhost:3000/maps');

            assert.deepPropertyVal(har, 'log.entries[1].startedDateTime', '2010-01-01T00:00:01.000Z');
            assert.deepPropertyVal(har, 'log.entries[1].time', 2000);

            assert.notDeepProperty(har, 'log.entries[1].response._error');
            assert.notDeepProperty(har, 'log.entries[1].response._error');
            done();
          });
      });
  });

  it('can disable automatic redirect', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.setHeader('location', '/maps');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', followRedirect: false })
          .on('end', () => {
            const har = captureHar.stop();
            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://localhost:3000/maps');
            assert.lengthOf(har.log.entries, 1);
            done();
          });
      });
  });

  it('can do maxRedirects', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.setHeader('location', '/');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', maxRedirects: 5 })
          .on('end', () => {
            const har = captureHar.stop();

            assert.lengthOf(har.log.entries, 6);
            assert.deepPropertyVal(har, 'log.entries[5].response._error.message', 'Max redirects exceeded');
            assert.deepPropertyVal(har, 'log.entries[5].response._error.code', 'MAXREDIRECTS');
            done();
          });
      });
  });

  it('can do followRedirect by function', done => {
    utils.mockServer(3000, (req, res) => {
      if (req.url === '/') {
        res.statusCode = 301;
        res.setHeader('location', '/1');
        res.setHeader('redirect', '1');
        res.end();
      } else if (req.url === '/1') {
        res.statusCode = 301;
        res.setHeader('location', '/2');
        res.end();
      } else if (req.url === '/2') {
        res.end();
      }
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({
          url: 'http://localhost:3000',
          followRedirect: (res) => {
            return !!res.headers.redirect;
          }
        })
          .on('end', () => {
            const har = captureHar.stop();
            assert.lengthOf(har.log.entries, 2);
            done();
          });
      });
  });

  it('handles location header on other statuscodes', done => {
    utils.mockServer(3000, (req, res) => {
      res.setHeader('location', '/path');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000' })
          .on('end', () => {
            const har = captureHar.stop();

            assert.lengthOf(har.log.entries, 1);
            done();
          });
      });
  });

  it('redirect should rewrite the host header when it was defined', done => {
    Promise.all([
      utils.mockServer(3000, (req, res) => {
        res.statusCode = 301;
        res.setHeader('location', 'http://localhost:3001');
        res.end(`${req.rawHeaders[0]}: ${req.rawHeaders[1]}`);
      }),
      utils.mockServer(3001, (req, res) => res.end(`${req.rawHeaders[0]}: ${req.rawHeaders[1]}`))
    ])
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', headers: { Host: 'localhost:3000' } })
          .on('end', () => {
            const har = captureHar.stop();

            assert.deepPropertyVal(har, 'log.entries[0].response.content.text', 'Host: localhost:3000');
            assert.deepPropertyVal(har, 'log.entries[1].response.content.text', 'Host: localhost:3001');

            assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].name', 'host');
            assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].value', 'localhost:3000');
            assert.deepPropertyVal(har, 'log.entries[1].request.headers[0].name', 'host');
            assert.deepPropertyVal(har, 'log.entries[1].request.headers[0].value', 'localhost:3001');
            done();
          });
      });
  });

  it('redirect should rewrite the host header when it was missing', done => {
    Promise.all([
      utils.mockServer(3000, (req, res) => {
        res.statusCode = 301;
        res.setHeader('location', 'http://localhost:3001');
        res.end(`${req.rawHeaders[0]}: ${req.rawHeaders[1]}`);
      }),
      utils.mockServer(3001, (req, res) => res.end(`${req.rawHeaders[0]}: ${req.rawHeaders[1]}`))
    ])
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', headers: {} })
          .on('end', () => {
            const har = captureHar.stop();

            assert.deepPropertyVal(har, 'log.entries[0].response.content.text', 'host: localhost:3000');
            assert.deepPropertyVal(har, 'log.entries[1].response.content.text', 'host: localhost:3001');

            assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].name', 'host');
            assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].value', 'localhost:3000');
            assert.deepPropertyVal(har, 'log.entries[1].request.headers[0].name', 'host');
            assert.deepPropertyVal(har, 'log.entries[1].request.headers[0].value', 'localhost:3001');
            done();
          });
      });
  });

  it('redirect should log an empty response on unsupported protocol', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.setHeader('location', 'file:///etc/passwd');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000' })
          .on('end', () => {
            const har = captureHar.stop();
            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.deepPropertyVal(har, 'log.entries[0].response.headers[0].name', 'location');
            assert.deepPropertyVal(har, 'log.entries[0].response.headers[0].value', 'file:///etc/passwd');

            assert.deepPropertyVal(har, 'log.entries[1].request.url', '');
            assert.deepPropertyVal(har, 'log.entries[1].request.headers.length', 0);

            assert.deepPropertyVal(har, 'log.entries[1].response._error.message', 'Cannot read property \'uri\' of undefined');
            done();
          });
      });
  });

  it('redirect should log correct host and url on IPv6 ip addresses', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.setHeader('location', 'http://[::1]:3000/');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', followRedirect: true, maxRedirects: 1 })
          .on('end', () => {
            const har = captureHar.stop();

            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://[::1]:3000/');
            done();
          });
      });
  });

  it('redirect should add trailing slash if not specified in location header', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.setHeader('location', 'http://localhost:3000');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', followRedirect: true, maxRedirects: 1 })
          .on('end', () => {
            const har = captureHar.stop();

            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://localhost:3000/');
            done();
          });
      });
  });

  it('redirect should resolve relative URLs', done => {
    utils.mockServer(3000, (req, res) => {
      res.statusCode = 301;
      res.setHeader('location', '../../../../');
      res.end();
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', followRedirect: true, maxRedirects: 1 })
          .on('end', () => {
            const har = captureHar.stop();

            assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
            assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://localhost:3000/');
            done();
          });
      });
  });

  it('should have remoteAddress after redirect', done => {
    utils.mockServer(3000, (req, res) => {
      if (req.url === '/') {
        res.statusCode = 301;
        res.setHeader('location', '/1');
        res.setHeader('redirect', '1');
        res.end();
      } else if (req.url === '/1') {
        res.end();
      }
    })
      .then(() => {
        const captureHar = new CaptureHar(request);
        captureHar.start({ url: 'http://localhost:3000', followRedirect: true })
          .on('end', () => {
            const har = captureHar.stop();
            assert(net.isIP(har.log.entries[1].response._remoteAddress));
            done();
          });
      });
  });
});
