var captureHarRaw = require('..');
var validateHar = require('har-validator').har;
console.log(validateHar);

function captureHar (...args) {
  return captureHarRaw(...args)
    .then(data => {
      return validateHar(data)
        .catch(err => {
          var firstError = err.errors[0];
          throw new Error(`"${firstError.field}" (${firstError.type}) ${firstError.message}`);
        });
    });
}

module.exports = captureHar;
