const through = require('through');
const pkg = require('../package');
const { buildHarConfig } = require('./buildHar');
const { capturePromiseEntries, captureEntries } = require('./captureEntries');

function buildRequestConfig (requestConfig) {
  if (typeof requestConfig === 'string') {
    return { url: requestConfig };
  }
  return requestConfig;
}

function captureHar (requestConfig, harConfig = {}) {
  return capturePromiseEntries(
    buildRequestConfig(requestConfig),
    buildHarConfig(harConfig)
  )
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

class CaptureHar {
  constructor (requestModule) {
    this.requestModule = requestModule;
    this.entries = [];
  }
}

CaptureHar.prototype.start = function (requestConfig, harConfig = {}, depth = 1) {
  const throughStream = through(
    data => throughStream.emit('data', data),
    () => throughStream.emit('end')
  );

  captureEntries({
    requestConfig: buildRequestConfig(requestConfig),
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

captureHar.CaptureHar = CaptureHar;

module.exports = captureHar;
