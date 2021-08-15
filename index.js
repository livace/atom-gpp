const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const CompositeDisposable = require('atom').CompositeDisposable;
const Point = require('atom').Point;
const Range = require('atom').Range;

let editor = '';

let compiler = {

  compile: function (runAfter) {
    editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      if (atom.config.get('gpp.showNotifications')) atom.notifications.addFatalError('Editor not found');
      return;
    }
    editor.save();

    const file = editor.buffer.file;
    if (!file) {
      if (atom.config.get('gpp.showNotifications')) atom.notifications.addError('File not found. Save before compiling');
      return;
    }

    const filePath = path.parse(file.path);
    const fileExt = filePath.ext;
    const compiledPath = path.join(filePath.dir, filePath.name);

    if (fileExt !== '.cc' && fileExt !== '.cpp' && fileExt !== '.C') {
      atom.notifications.addError('Wrong extension ' + fileExt + '<br> Only .cc, .cpp, and .C file extensions are allowed');
      return 0;
    }

    const options = atom.config.get('gpp.compilerOptions').replace(/[\s{2,}]+/g, ' ').trim();
    path.join(filePath.dir, filePath.name);
    let newOptions = [file.path, '-o', compiledPath]
    if (options != ""){
      newOptions = newOptions.concat(options.split(' '));
    }
    const child = child_process.spawn('g++', newOptions, {
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
        fs.writeFile(path.join(filePath.dir, 'compiling_error.txt'), stderr, (err) => {
            if (err) {
                atom.notifications.addError('Failed to save ' + path.join(filePath.dir, 'compiling_error.txt') + ' <br /> ' + err);
            }
        });
      }

      if (atom.config.get('gpp.highlightErrors')) {
        errorParser.highlight();
      }
      if (code) {
        if (atom.config.get('gpp.showNotifications')) atom.notifications.addError(stderr.replace(/\n/g, '<br />'));

        if (atom.config.get('gpp.gotoErr')) {
          errorParser.next();
        }
      } else {
        if (atom.config.get('gpp.showNotifications')) atom.notifications.addSuccess('Compilation Successful');

        if (atom.config.get('gpp.showNotifications') && stderr && atom.config.get('gpp.showWarning')) {
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
          args = ['--hold', '-e'];
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
      const command = `start "${filePath.name}" cmd /C ""${compiledPath}" & echo.` + (atom.config.get('gpp.pause') ? ` & pause "` : `"`);
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
    hidden: false,
    err: [],
    activePanel: undefined,
    active: undefined,

    toggle: function () {
      if (!this.activePanel) this.update();
      if (this.activePanel.isVisible()){
          this.activePanel.hide();
          this.hidden = true;
      } else {
          this.activePanel.show();
          this.hidden = false;
      }
    },

    update: function () {
      let panel = document.createElement('div');

      let position = atom.config.get('gpp.panelPosition');
      let vertical = position === 'Left' || position === 'Right';

      panel.setAttribute('class', 'gpppanel ' + position);
      this.err = [];
      this.activeElement = undefined;

      let content = document.createElement('div');
      content.setAttribute('class', 'gpppanel');
      content.setAttribute('class', 'content');

      for (let i = 0; i < errorParser.errs.length; i++) {
        this.err[i] = document.createElement('p');
        this.err[i].innerHTML = errorParser.errs[i].text;
        this.err[i].setAttribute('class', 'gpp' + errorParser.errs[i].type);
        this.err[i].addEventListener('click', function () {
          errorParser.gotoErr(i);
        });
        content.appendChild(this.err[i]);
      }

      if (!vertical && !this.curHeight) {
        this.curHeight = '150px';
      }
      if (vertical && !this.curWidth) {
        this.curWidth = '300px';
      }
      if (vertical) {
        panel.style.width = this.curWidth;
        content.style.width = (Number(this.curWidth.replace('px', '')) - 30) + 'px';
        content.style.height = '100%';
      } else {
        panel.style.height = this.curHeight;
        content.style.height = (Number(this.curHeight.replace('px', '')) - 30) + 'px';
        content.style.width = '100%';
      }

      panel.addEventListener('mousedown', mouseDownEvent);

      let firstY, firstX, firstWidth, firstHeight;

      function mouseDownEvent (event) {
        if (vertical) {
          firstX = event.clientX;
          firstWidth = Number(panel.style.width.replace('px', ''));
        } else {
          firstY = event.clientY;
          firstHeight = Number(panel.style.height.replace('px', ''));
        }

        document.body.addEventListener('mousemove', moveTo);
        document.body.addEventListener('mouseup', mouseUpEvent);
      }

      function mouseUpEvent (event) {
        document.body.removeEventListener('mousemove', moveTo);
        document.body.removeEventListener('mouseup', mouseUpEvent);
      }

      function moveTo (event) {
        if (vertical) {
          let newWidth;
          if (position === 'Right') newWidth = firstWidth + firstX - event.clientX;
          else newWidth = firstWidth - firstX + event.clientX;
          errorParser.panel.curWidth = String(newWidth) + 'px';
          panel.style.width = errorParser.panel.curWidth;
          content.style.width = String(newWidth - 30) + 'px';
        } else {
          let newHeight;
          if (position === 'Bottom') newHeight = firstHeight + firstY - event.clientY;
          else newHeight = firstHeight - firstY + event.clientY;
          errorParser.panel.curHeight = String(newHeight) + 'px';
          console.log('New Height: ' + errorParser.panel.curHeight);
          panel.style.height = errorParser.panel.curHeight;
          content.style.height = String(newHeight - 30) + 'px';
        }
      }

      panel.appendChild(content);

      if (this.activePanel) this.activePanel.destroy();

      if (position === 'Left') {
        this.activePanel = atom.workspace.addLeftPanel({
          item: panel
        });
      } else if (position === 'Right') {
        this.activePanel = atom.workspace.addRightPanel({
          item: panel
        });
      } else if (position === 'Top') {
        this.activePanel = atom.workspace.addTopPanel({
          item: panel
        });
      } else {
        this.activePanel = atom.workspace.addBottomPanel({
          item: panel
        });
      }

      if(this.hidden) this.activePanel.hide();
    },

    mark: function (curErr) {
      if (this.activeElement !== undefined) {
        this.err[this.activeElement].classList.remove('active');
      }
      this.activeElement = curErr;

      let nodeTop = this.err[curErr].offsetTop - this.activePanel.getItem().childNodes[0].offsetTop;
      this.activePanel.getItem().childNodes[0].scrollTop = nodeTop;

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
        compiler.compile(true); // Ideas how to make running if compile success better than run = true/false?
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
    },
    showNotifications: {
      default: true,
      title: 'Show notifications',
      description: 'Show notifications about compilation results',
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
module.exports.config.panelPosition = {
  default: 'Bottom',
  enum: [
    'Bottom',
    'Left',
    'Right',
    'Top'
  ],
  title: 'Panel Position',
  type: 'string'
};

if (process.platform === 'win32') {
  module.exports.config.pause = {
    default: true,
    title: 'Pause program after running',
    type: 'boolean'
  }
}

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
