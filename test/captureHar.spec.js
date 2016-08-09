/* global describe, it, afterEach */

var assert = require('chai').assert;
var captureHar = require('./captureHar');
var nock = require('nock');
var lolex = require('lolex');
var utils = require('./utils');

describe('captureHar', function () {
  afterEach(function () {
    if (this.clock) {
      this.clock.uninstall();
    }
    nock.cleanAll();
  });

  it('captures simple requests', function () {
    this.clock = lolex.install(1262304000000);
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, () => {
        this.clock.tick(120);
        return 'body';
      });
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].startedDateTime', '2010-01-01T00:00:00.000Z');
        assert.deepPropertyVal(har, 'log.entries[0].time', 120);

        assert.deepPropertyVal(har, 'log.entries[0].request.method', 'GET');
        assert.deepPropertyVal(har, 'log.entries[0].request.url', 'http://www.google.com/');

        assert.deepPropertyVal(har, 'log.entries[0].response.status', 200);
        assert.deepPropertyVal(har, 'log.entries[0].response.content.size', 4);
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.deepPropertyVal(har, 'log.entries[0].response.content.text', 'body');
      });
  });

  it('passes on headers', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, { hello: 'world' }, {
        'content-type': 'application/json',
        'x-test': 'response',
        'x-array': [ 'x', 'y' ]
      });
    return captureHar({
      url: 'http://www.google.com',
      headers: {
        'host': 'www.google.com',
        'x-test': 'request'
      }
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].name', 'host');
        assert.deepPropertyVal(har, 'log.entries[0].request.headers[0].value', 'www.google.com');
        assert.deepPropertyVal(har, 'log.entries[0].request.headers[1].name', 'x-test');
        assert.deepPropertyVal(har, 'log.entries[0].request.headers[1].value', 'request');

        assert.deepPropertyVal(har, 'log.entries[0].response.headers[0].name', 'content-type');
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[0].value', 'application/json');
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[1].name', 'x-test');
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[1].value', 'response');
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'application/json');

        assert.deepPropertyVal(har, 'log.entries[0].response.headers[2].name', 'x-array');
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[2].value', 'x');
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[3].name', 'x-array');
        assert.deepPropertyVal(har, 'log.entries[0].response.headers[3].value', 'y');
      });
  });

  it('parses querystring', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .query({ param1: 'value1', param2: 'value2' })
      .reply(200, 'body');
    return captureHar({
      url: 'http://www.google.com?param1=value1&param2=value2'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[0].name', 'param1');
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[0].value', 'value1');
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[1].name', 'param2');
        assert.deepPropertyVal(har, 'log.entries[0].request.queryString[1].value', 'value2');
      });
  });

  it('handles request errors', function () {
    var err = new Error('Error: getaddrinfo ENOTFOUND');
    err.code = 'ENOTFOUND';
    this.scope = nock('http://www.google.com')
      .get('/')
      .replyWithError(err);
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.method', 'GET');
        assert.deepPropertyVal(har, 'log.entries[0].request.url', 'http://www.google.com/');

        assert.deepPropertyVal(har, 'log.entries[0].response.status', 0);
        assert.deepPropertyVal(har, 'log.entries[0].response._error.code', 'ENOTFOUND');
        assert.deepPropertyVal(har, 'log.entries[0].response._error.message', 'Error: getaddrinfo ENOTFOUND');
      });
  });

  it('handles status errors', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(404);
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 404);
      });
  });

  it('can ignore body content', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, 'hello');
    return captureHar({
      url: 'http://www.google.com'
    }, { withContent: false })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.content.size', 5);
        assert.deepPropertyVal(har, 'log.entries[0].response.content.mimeType', 'x-unknown');
        assert.notDeepProperty(har, 'log.entries[0].response.content.text');
      });
  });

  it('normalizes methods', function () {
    this.scope = nock('http://www.google.com')
      .post('/')
      .reply(200, 'hello');
    return captureHar({
      method: 'post',
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].request.method', 'POST');
      });
  });

  it('understands cookies', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, 'hello', {
        'set-cookie': [
          'cookie3=value3; Expires=Fri Jan 01 2010 01:00:00 GMT+0100 (CET); Domain=www.google.com; Path=/path; Secure; HttpOnly',
          'cookie4=value4'
        ]
      });
    return captureHar({
      url: 'http://www.google.com',
      headers: {
        cookie: 'cookie1=value1; cookie2=value2'
      }
    })
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
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].expires', '2010-01-01T01:00:00.000Z');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].httpOnly', true);
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].secure', true);
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[1].name', 'cookie4');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[1].value', 'value4');
        assert.notDeepProperty(har, 'log.entries[0].response.cookies[1].path');
      });
  });

  it('understands single set-cookie', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, 'hello', {
        'set-cookie': 'cookie=value'
      });
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].name', 'cookie');
        assert.deepPropertyVal(har, 'log.entries[0].response.cookies[0].value', 'value');
      });
  });

  it('doesn\'t crash on invalid cookies', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, 'hello', {
        'set-cookie': 'Secure; HttpOnly'
      });
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.lengthOf(har.log.entries[0].response.cookies, 0);
      });
  });
});
