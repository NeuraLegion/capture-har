var { captureHar } = require('..');
var validateHar = require('har-validator').default;

function captureHarRaw (...args) {
  return captureHar(...args)
    .then(data => {
      return validateHar(data)
        .catch(err => {
          var firstError = err.errors[0];
          throw new Error(`"${firstError.field}" (${firstError.type}) ${firstError.message}`);
        });
    });
}

module.exports = captureHarRaw;
