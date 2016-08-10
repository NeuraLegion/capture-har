# capture-har

Fetch requests in HAR format

This module makes a request and captures it as a [HAR](http://www.softwareishard.com/blog/har-12-spec/) object.
Under the covers it uses [request](https://www.npmjs.com/package/request) and just passes throough all options.
Currently only GET requests are supported although other methods will probably work. The request body might not be properly captured though.

## API

```js
var captureHar = require('capture-har');
captureHar({
  url: 'http://www.google.com'
}, { withContent: false })
  .then(har => {
    console.log(JSON.stringify(har, null, 2));
  });
```

### `captureHar`

```
captureHar(Object requestOptions, Object harOptions) -> Promise<Object>
```

#### `requestOptions`

The [options](https://www.npmjs.com/package/request#requestoptions-callback) for making the request, is just passed through to request package.

#### `harOptions`

##### `withContent`

Defaults to `true`. Specifies whether the response content object should contain the full body of the response.
