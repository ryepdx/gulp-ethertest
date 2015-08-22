var gulp = require('gulp');
var jshint = require('gulp-jshint');
var notify = require('gulp-notify');

var allFiles = ['*.js'];
gulp.task('hint', function () {
  gulp.src(allFiles)
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(notify(function (file) {
      if (file.jshint.success) { return; }
      var errors = file.jshint.results.map(function (data) {
        if (data.error) {
          return "(" + data.error.line + ':' + data.error.character + ') ' + data.error.reason;
        }
      }).join("\n");
      return file.relative + " (" + file.jshint.results.length + " errors)\n" + errors;
    }));
});

gulp.task('watch', ['hint'], function() {
  gulp.watch(allFiles, ['hint']);
});

gulp.task('default', ['watch']);
