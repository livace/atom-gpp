const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
// const os = require('os');
const CompositeDisposable = require('atom').CompositeDisposable;
const Point = require('atom').Point;
const Range = require('atom').Range;
// import {ResizeablePanel} from './lib/resizable-panel';
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
      if (atom.config.get('gpp.showCompilationPanel')) errorParser.panel.update();

      if (atom.config.get('gpp.addCompilingErr')) {
        fs.writeFile(path.join(filePath.dir, 'compiling_error.txt'), stderr);
      }
      if (atom.config.get('gpp.highlightErrors')) {
        errorParser.highlight();
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
      const command = `start "${filePath.name}" cmd /C ${compiledPath} & echo.`;
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
    this.curErr++;
    if (this.curErr >= this.errs.length) this.curErr = 0;
    this.gotoErr(this.curErr);
  },

  prev: function () {
    this.curErr--;
    if (this.curErr < 0) {
      this.curErr = this.errs.length - 1;
    }
    this.gotoErr(this.curErr);
  },

  gotoErr: function (err) {
    if (err < 0 || err > this.errs.length) err = 0;

    this.curErr = err;
    const curPoint = this.errs[this.curErr];
    if (!curPoint) return;

    const position = new Point(curPoint.row, curPoint.column);
    this.setCursorPosition(position);

    if (atom.config.get('gpp.showCompilationPanel')) this.panel.mark(this.curErr);
  },

  parse: function (stderr) {
    this.curErr = -1;
    this.errs = [];
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

    for (let i = 0; i < buf.length; i++) {
      for (let j = buf[i].id; j < tmpErrs.length && (i + 1 === buf.length || j < buf[i + 1].id); j++) {
        if (buf[i].text !== '') buf[i].text += '<br />';
        buf[i].text += tmpErrs[j];
      }
    }

    if (atom.config.get('gpp.showWarning')) {
      this.errs = buf;
      return;
    }

    let curErr = 0;
    while (curErr < buf.length) {
      if (buf[curErr].type === 'warning') {
        while (curErr < buf.length && buf[curErr] !== 'error') curErr++;
      } else {
        this.errs.push(buf[curErr]);
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

  highlight: function () {
    for (let i = 0; i < this.markers.length; i++) {
      this.markers[i].destroy();
    }
    this.markers = [];
    if (atom.config.get('gpp.highlightErrors')) {
      for (let i = 0; i < this.errs.length; i++) {
        const range = Range(new Point(this.errs[i].row, 0), new Point(this.errs[i].row + 1, 0));
        const marker = editor.markBufferRange(range);

        this.markers.push(editor.decorateMarker(marker, {
          type: 'line',
          class: 'gppeditor' + this.errs[i].type
        }));
      }
    }
  },

  panel: {
    err: [],
    activePanel: undefined,
    active: undefined,

    toggle: function () {
      if (!this.activePanel) this.update();
      if (this.activePanel.isVisible()) this.activePanel.hide();
      else this.activePanel.show();
    },

    update: function () {
      let panel = document.createElement('div');
      if (!this.curHeight) this.curHeight = '150px'
      panel.style.height = this.curHeight;
      panel.setAttribute('class', 'gppbottompanel');

      this.err = [];
      this.active = undefined;

      let content = document.createElement('div');
      content.style.width = '100%';
      content.style.height = '120px';
      content.setAttribute('class', 'gppbottompanelcontent');

      for (let i = 0; i < errorParser.errs.length; i++) {
        this.err[i] = document.createElement('p');
        this.err[i].innerHTML = errorParser.errs[i].text;
        this.err[i].setAttribute('class', 'gpp' + errorParser.errs[i].type);
        this.err[i].addEventListener('click', function () {
          errorParser.gotoErr(i);
        });
        content.appendChild(this.err[i]);
      }

      let resizer = document.createElement('div');
      resizer.style.width = '100%';
      resizer.style.height = '30px';
      resizer.style.cursor = 'ns-resize';

      let firstY, firstHeight;
      resizer.addEventListener('mousedown', mouseDownEvent);

      function mouseDownEvent (event) {
        firstY = event.clientY;
        firstHeight = Number(panel.style.height.replace('px', ''));
        document.body.addEventListener('mousemove', moveTo);
        document.body.addEventListener('mouseup', mouseUpEvent);
      }

      function mouseUpEvent (event) {
        document.body.removeEventListener('mousemove', moveTo);
        document.body.removeEventListener('mouseup', mouseUpEvent);
      }

      function moveTo (event) {
        let newHeight = firstHeight + firstY - event.clientY;
        errorParser.panel.curHeight = String(newHeight) + 'px';
        panel.style.height = errorParser.panel.curHeight;
        content.style.height = String(newHeight - 30) + 'px';
      }

      panel.appendChild(resizer);
      panel.appendChild(content);

      if (this.activePanel) this.activePanel.destroy();
      this.activePanel = atom.workspace.addBottomPanel({
        item: panel
      });
    },

    mark: function (curErr) {
      if (this.active !== undefined) {
        this.err[this.active].classList.remove('active');
      }
      this.active = curErr;

      let nodeTop = this.err[curErr].offsetTop - this.activePanel.getItem().childNodes[1].offsetTop;
      this.activePanel.getItem().childNodes[1].scrollTop = nodeTop;

      this.err[curErr].classList.add('active');
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
      },
      'gpp:togglePanel': () => {
        errorParser.panel.toggle();
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
    highlightErrors: {
      default: true,
      title: 'Highlight errors',
      description: 'Highlights lines with errors',
      type: 'boolean'
    },
    showCompilationPanel: {
      default: true,
      title: 'Show compilation panel',
      description: 'Show panel with compilation results',
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

// if (atom.config.get('gpp.showCompilationPanel')) {
//   module.exports.config.panelPosition = {
//     default: 'Bottom',
//     enum: [
//       'Bottom',
//       'Left',
//       'Right',
//       'Top'
//     ],
//     title: 'Panel Position',
//     type: 'string'
//   };
// }
// Will be in next version

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
