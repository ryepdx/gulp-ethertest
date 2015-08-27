# gulp-ethertest

## What is it?
A through-stream that collects compiled test contracts passed through it and runs them upon closing. Inspired by my desire to incorporate testing contracts into my Gulp workflow. That said, I'm a Gulp newbie and not really familiar with Javascript's streams concept yet, so I'm sure there are things that can be improved regarding my approach. Pull requests are always welcome.

## How do I install it?

Most likely, you'll want to install it like this:

```
npm install gulp-ethertest --save-dev
```

But you'd be better off using [npm link](https://60devs.com/simple-way-to-manage-local-node-module-using-npm-link.html) if you're looking to make local modificationsafter installing it. (As one does when one is making improvements for a potential pull request, for example.)

## How do I use it?

gulp-ethertest runs smart contracts that test other smart contracts and reports back on their success or failure. The best way to get started is to write a contract that inherits from the `Test` contract in the included `test.sol` file. Here's an example of a simple contract with one failing test and one passing test:

```
import "test.sol";

contract ExampleTest is Test {
    function shouldPass() {
        Assert(true);
    }

    function shouldFail() {
        Assert(false);
    }
}
```

We could also include logging messages, since it inherits from Logger (in `loggable.sol`) indirectly.

```
    ...
    function shouldPass() {
        Log("This test will pass.");
        LogStr("Loggers are type-specific (for now).");
        LogUint(42);
        Assert(true);
    }
    ...
```

Of course, if we were testing an actual contract and needed to get logging from within that contract without necessarily setting a watcher on that contract's logging events in particular, we could use the `setLogger` function to pass in our test contract as a logger:

```
import "test.sol";

contract MyContract is Loggable {
    function echoAndLog(uint num) returns (uint) {
        Log("We were passed this number:");
        LogUint(num);
        return num
    }
}

contract MyContractTest is Test {
    function shouldReturnNumber() {
        MyContract contract = new MyContract();
        contract.setLogger(this);
        Assert(contract.echoAndLog(42) == 42);
    }
}

```

And then, to set up the Gulp task:

```
gulp.task('test', ['build'], function() {
  var ethertest = require('gulp-ethertest');
  gulp.src(['./build/contracts/*.bin', './build/contracts/*.abi'])
    .pipe(ethertest({
      primaryAccount: 'c9af70780561e36666871fe2bef49c5f72fb3904',
      gas: 2500000, gasPrice: 10, colors: true
    }));
});
```

Modify it to your liking. (Changing the `primaryAccount` option is probably a good start.)

## Notes

### Important Details

Test functions must start with either the word "should" or "test," and test contracts must end with the word "Test" and supply an "Assert" event that takes a boolean. Otherwise ethertest will assume you don't mean for it to be treated as a test and will skip it.

Ethertest doesn't catch all the common failure modes just yet. In particular, geth will sometimes hold on to pending transactions and never actually mine them, which leads to Ethertest hanging.

Only the first Assert event in your test function will get reported on. But let's be real here: you should really only be using [one assertion per test](http://www.artima.com/weblogs/viewpost.jsp?thread=35578) anyway. Even less intuitively, though, Ethertest will wait forever for an Assert event if it has decided your function is a test function and it doesn't ever trigger an Assert event. So there has to be a 1-to-1 relationship between your functions and Asserts. (It *will* detect if your transaction has run out of gas, though, so no worries there.)

By default, test results are written to stdout. This can be overridden when ethertest is instantiated by setting the `outstream` option to a different stream object. All the options available and their default values are show below as a JSON object:

```
{
    web3: null,
    primaryAddress: null,
    gas: null,
    gasPrice: null,
    endowment: 0,
    value: 0,
    rpcURL: 'http://localhost:8545',
    outstream: process.stdout,
    colors: true
}
```

If `web3` is supplied, it should be a `web3` object with an RPC provider set.

If `rpcURL` is supplied, it will be used to create an HttpProvider object and set it as web3's RPC provider. If no web3 object was passed in, ethertest will supply its own.

`primaryAddress` is the address from which ethertest will send all its transactions.

`gas` and `gasPrice` are the gas and gas prices ethertest will set on all its transactions.

`endowment` is how much wei to supply your test contracts with upon instantiation.

`value` is how much wei to send with each non-creation transaction.


### Compilation

For compiling your contracts within your Gulp workflow, you might try [smake](https://github.com/androlo/gulp-smake). If you do try it, here's a snippet that might save you some trouble:

```
var gulp = require('gulp');
var smake = require('gulp-smake');
var crypto = require('crypto');
var os = require('os');
var fs = require('fs-extra');
var path = require('path');

var tmpDir = (function () {
  var hash = crypto.createHash('sha1');
  hash.update(__dirname);
  return path.join(os.tmpdir(), hash.digest('base64'));
})();

var solidityPaths = ['./src/contracts/*.sol', './src/contracts/**/*.sol'];
gulp.task('pre-build-contracts', function () {
  fs.emptyDirSync(tmpDir);
  return gulp.src(solidityPaths, {base: 'src'})
    .pipe(gulp.dest(tmpDir));
});

gulp.task('build-contracts', ['pre-build-contracts'], function () {
  return gulp.src(solidityPaths)
    .pipe(smake.build({
        paths: solidityPaths,
        root: __dirname, 
        sourceDir: 'src/contracts',
        buildDir: 'build/contracts',
        docsDir: 'docs/contracts',
        compilerFlags: "--optimize --bin --abi --devdoc -o ."
    }, {base: tmpDir + '/contracts'}));
});.
``` 

If Solidity complains, it's possible you're using an older version of it. The core developers recently changed the flags it accepts. Try changing the `compilerFlags` option in the example above to something your copy of `solc` can understand.
