function log (har) {
  console.log(require('util').inspect(har, {
    depth: 10,
    colors: true
  }));
}

module.exports = {
  log
};
