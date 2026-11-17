// Safari runs this before the share sheet opens: it hands the extension the selected text, title and URL.
var Selection = function () {};
Selection.prototype = {
  run: function (args) {
    args.completionFunction({ selection: (window.getSelection() || '').toString(), title: document.title, url: document.URL });
  },
  finalize: function () {}
};
var ExtensionPreprocessingJS = new Selection();
