const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
// const os = require('os');
const CompositeDisposable = require('atom').CompositeDisposable;
const Point = require('atom').Point;
const Range = require('atom').Range;

let editor = '';

let compiler = {

  compile: function (runAfter) {
    editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      atom.notifications.addFatalError('Editor not found');
      return;
    }
    editor.save();

    const file = editor.buffer.file;
    if (!file) {
      atom.notifications.addError('File not found. Save before compiling');
      return;
    }

    const filePath = path.parse(file.path);
    const fileExt = filePath.ext;
    const compiledPath = path.join(filePath.dir, filePath.name);

    if (fileExt !== '.cpp') {
      atom.notifications.addError('Wrong extention ' + fileExt + '<br> Only .cpp is allowed');
      return 0;
    }

    const options = (file.path + ' -o ' + compiledPath + ' ' + atom.config.get('gpp.compilerOptions')).replace(/[\s{2,}]+/g, ' ').trim();

    path.join(filePath.dir, filePath.name);

    const child = child_process.spawn('g++', options.split(' '), {
      cwd: filePath.dir
    });

    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data;
    });

    child.on('close', (code) => {
      errorParser.parse(stderr);
      errorParser.mark();
      // errorParser.panel.update();

      if (atom.config.get('gpp.addCompilingErr')) {
        fs.writeFile(path.join(filePath.dir, 'compiling_error.txt'), stderr);
      }
      if (code) {
        atom.notifications.addError(stderr.replace(/\n/g, '<br />'));

        if (atom.config.get('gpp.gotoErr')) {
          errorParser.next();
        }
      } else {
        atom.notifications.addSuccess('Compilation Successful');

        if (stderr && atom.config.get('gpp.showWarning')) {
          atom.notifications.addWarning(stderr.replace(/\n/g, '<br />'));
        }
        if (runAfter) compiler.run();
      }
    });
  },

  run: function () {
    if (!editor) {
      return;
    }

    const file = editor.buffer.file;
    if (!file) {
      atom.notifications.addError('File not found. Save before running');
      return;
    }

    const filePath = path.parse(file.path);
    const options = {
      cwd: filePath.dir
    };
    const compiledPath = path.join(filePath.dir, filePath.name);
    if (process.platform === 'linux') {
      const terminal = atom.config.get('gpp.linuxTerminal');
      let terminalCommand = null;
      let args = null;
      switch (terminal) {
        case 'GNOME Terminal':
          terminalCommand = 'gnome-terminal';
          args = ['--command'];
          break;

        case 'Konsole':
          terminalCommand = 'konsole';
          args = ['-e'];
          break;

        case 'xfce4-terminal':
          terminalCommand = 'xfce4-terminal';
          args = ['--command'];
          break;

        case 'pantheon-terminal':
          terminalCommand = 'pantheon-terminal';
          args = ['-e'];
          break;
        case 'URxvt':
          terminalCommand = 'urxvt';
          args = ['-e'];
          break;

        case 'MATE Terminal':
          terminalCommand = 'mate-terminal';
          args = ['--command'];
          break;

        default:
          terminalCommand = 'xterm';
          args = ['-e'];
      }

      child_process.spawn(terminalCommand, [
        ...args,
        compiledPath
      ], options);
    }
    if (process.platform === 'win32') {
      const command = `start '${filePath.name}' cmd /C ${compiledPath} & echo.`;
      child_process.exec(command, options);
    } else if (process.platform === 'darwin') {
      child_process.spawn('open', [compiledPath], options);
    }
  }
};

let errorParser = {
  errs: [],
  curErr: 0,
  markers: [],
  next: function () {
    errorParser.curErr++;
    if (errorParser.curErr >= errorParser.errs.length) errorParser.curErr = 0;
    errorParser.gotoErr(errorParser.curErr);
  },

  prev: function () {
    errorParser.curErr--;
    if (errorParser.curErr < 0) {
      errorParser.curErr = errorParser.errs.length - 1;
    }
    errorParser.gotoErr(errorParser.curErr);
  },

  gotoErr: function (err) {
    errorParser.curErr = err;
    const curPoint = errorParser.errs[errorParser.curErr];
    const position = new Point(curPoint.row, curPoint.column);
    errorParser.setCursorPosition(position);
  },

  parse: function (stderr) {
    errorParser.errs = [];
    if (!editor) return;
    if (!stderr) {
      return;
    }
    let tmpErrs = stderr.split('\n');
    let buf = [];
    for (let curErr = 0; curErr < tmpErrs.length; curErr++) {
      let res = tmpErrs[curErr].split(':');

      let path = '';
      let i = 0;

      while (i < res.length && isNaN(res[i])) {
        if (i > 0) path += ':';
        path += res[i];
        i++;
      }

      if (path !== editor.buffer.file.path) {
        continue;
      }

      if (i >= res.length - 2) {
        continue;
      }

      if (isNaN(res[i + 1])) {
        continue;
      }

      let row = Number(res[i]) - 1;
      let column = Number(res[i + 1]) - 1;
      let type = res[i + 2].trim();

      if (type !== 'error' && type !== 'warning') {
        type = 'note';
      }

      buf.push({
        'id': curErr, // line in stderr
        'row': row,
        'column': column,
        'type': type,
        'text': ''
      });
    }
    for (let i = 0; i < buf.lenght; i++){
      for (let j = buf[i].id; j < )
    }
    if (atom.config.get('gpp.showWarning')) {
      errorParser.errs = buf;
      return;
    }
    let curErr = 0;
    while (curErr < buf.length) {
      if (buf[curErr].type === 'warning') {
        while (curErr < buf.length && buf[curErr] !== 'error') curErr++;
      } else {
        errorParser.errs.push(buf[curErr]);
        curErr++;
      }
    }
  },

  setCursorPosition: function (position) {
    if (!editor) {
      return;
    }
    editor.setCursorBufferPosition(position);
  },

  mark: function () {
    for (let i = 0; i < errorParser.markers.length; i++) {
      errorParser.markers[i].destroy();
    }
    errorParser.markers = [];
    if (atom.config.get('gpp.higlightErrors')) {
      for (let i = 0; i < errorParser.errs.length; i++) {
        const range = Range(new Point(errorParser.errs[i].row, 0), new Point(errorParser.errs[i].row + 1, 0));
        const marker = editor.markBufferRange(range);
        errorParser.markers.push(editor.decorateMarker(marker, {
          type: 'line',
          class: 'gpp' + errorParser.errs[i].type
        }));
      }
    }
  },

  panel: {
    create: function (stderr) {
      let panel = document.createElement('div');

      this.activePanel = atom.workspace.addBottomPanel({
        item: panel
      });
    }

  }

};

module.exports = {
  activate () {
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(atom.commands.add('atom-text-editor', {
      'gpp:compile': () => {
        compiler.compile(false);
      },
      'gpp:compile-run': () => {
        compiler.compile(true); // Ideas how to make running if compile success better than run = true/false
      },
      'gpp:run': () => {
        compiler.run();
      },
      'gpp:nextErr': () => {
        errorParser.next();
      },
      'gpp:prevErr': () => {
        errorParser.prev();
      }
    }));
  },
  config: {
    addCompilingErr: {
      default: true,
      description: 'Add a file named `compiling_error.txt` if compiling goes wrong',
      title: 'Add `compiling_error.txt`',
      type: 'boolean'
    },
    gotoErr: {
      default: true,
      description: 'If there are errors after compilation, cursor goes to the first.',
      title: 'Go to first error',
      type: 'boolean'
    },
    compilerOptions: {
      default: '',
      description: 'Compiler command line options',
      title: 'Compiler options',
      type: 'string'
    },
    showWarning: {
      default: true,
      title: 'Show warnings',
      type: 'boolean'
    },
    higlightErrors: {
      default: true,
      title: 'Higlight errors',
      description: 'Higlights lines with errors',
      type: 'boolean'
    }
  },
  deactivate () {
    this.subscriptions.dispose();
    for (let i = 0; i < errorParser.markers.length; i++) {
      errorParser.markers[i].destroy();
    }
    errorParser.markers = [];
  },
  subscriptions: null
};
if (process.platform === 'linux') {
  module.exports.config.linuxTerminal = {
    default: 'GNOME Terminal',
    enum: [
      'XTerm',
      'GNOME Terminal',
      'Konsole',
      'xfce4-terminal',
      'pantheon-terminal',
      'URxvt',
      'MATE Terminal'
    ],
    title: 'Linux terminal',
    type: 'string'
  };
}
