"use strict"

const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const CompositeDisposable = require("atom").CompositeDisposable;
const Point = require("atom").Point;



module.exports = {
    activate() {
        this.subscriptions = new CompositeDisposable();

        this.subscriptions.add(atom.commands.add("atom-text-editor", {
            "gpp:compile": () => {
                compile(false);
            },
            "gpp:compile-run": () => {
                compile(true); // Ideas how to make running if compile success better than run = true/false
            },
            "gpp:run": () => {
                run();
            },
            "gpp:nextErr": () => {
                nextErr();
            },
            "gpp:prevErr": () => {
                prevErr();
            }
        }));
    },
    config: {
        addCompilingErr: {
            default: true,
            description: "Add a file named `compiling_error.txt` if compiling goes wrong",
            title: "Add `compiling_error.txt`",
            type: "boolean"
        },
        gotoErr: {
            default: true,
            description: "If there are errors after compilation, cursor goes to the first.",
            title: "Go to first error",
            type: "boolean"
        },
        compilerOptions: {
            default: "",
            description: "Compiler command line options",
            title: "Compiler options",
            type: "string"
        },
        showWarning: {
            default: true,
            title: "Show warnings",
            type: "boolean"
        }
    },
    deactivate() {
        this.subscriptions.dispose();
    },
    subscriptions: null
}

if(process.platform === "linux"){
    module.exports.config.linuxTerminal = {
        default: "GNOME Terminal",
        enum: [
            "XTerm",
            "GNOME Terminal",
            "Konsole",
            "xfce4-terminal",
            "pantheon-terminal",
            "URxvt",
            "MATE Terminal"
        ],
        title: "Linux terminal",
        type: "string"
    };
}

let errs = [];
let curErr = 0;

function compile(runAfter){
    const editor = atom.workspace.getActiveTextEditor();
    if(!editor){
        atom.notifications.addFatalError("Editor not found");
        return;
    }
    editor.save();

    const file = editor.buffer.file;
    if(!file){
        atom.notifications.addError("File not found. Save before compiling");
        return;
    }

    const filePath = path.parse(file.path);
    const fileName = filePath.name;
    const fileExt = filePath.ext;
    const compiledPath = path.join(filePath.dir, filePath.name);

    if(fileExt != '.cpp'){
        atom.notifications.addError("Wrong extention " + fileExt + "<br> Only .cpp is allowed");
        return 0;
    }

    const options = (file.path + " -o " + compiledPath + atom.config.get("gpp.compilerOptions")).replace(/[\s{2,}]+/g, ' ').trim();

    console.log("Args: " + options);

    path.join(filePath.dir, filePath.name)


    const child = child_process.spawn("g++", options.split(' '), {cwd: filePath.dir});

    let stderr = "";

    child.stderr.on("data", (data) => {
  	  stderr += data;
    });

    child.on("close", (code) => {
        errs = stderr.split('\n');
        if(atom.config.get("gpp.addCompilingErr")){
            fs.writeFile(path.join(filePath.dir, "compiling_error.txt"), stderr ? stderr : "");
        }
        if(code){
            atom.notifications.addError(stderr.replace(/\n/g, "<br />"));

            if(atom.config.get("gpp.gotoErr")){
                curErr = -1;
                nextErr();
            }

        }
        else{
            atom.notifications.addSuccess("Compilation Successful");

            if(stderr && atom.config.get("gpp:showWarning"))
                atom.notifications.addWarning(stderr.replace(/\n/g, "<br />"));

            if(runAfter) run();
        }
    });
}

function run(){
    const editor = atom.workspace.getActiveTextEditor();
    if(!editor){
        atom.notifications.addFatalError("Editor not found");
        return;
    }

    const file = editor.buffer.file;
    if(!file){
        atom.notifications.addError("File not found. Save before running");
        return;
    }

    const filePath = path.parse(file.path);
    const options = {cwd: filePath.dir};
    const compiledPath = path.join(filePath.dir, filePath.name);
    if(process.platform === "linux"){
        const terminal = atom.config.get("gpp.linuxTerminal");
        let terminalCommand = null;
        let args = null;
        switch (terminal) {
            case "GNOME Terminal":
                terminalCommand = "gnome-terminal";
                args = [
                    "--command"
                ];
                break;

            case "Konsole":
                terminalCommand = "konsole";
                args = [
                    "-e"
                ];
                break;

            case "xfce4-terminal":
                terminalCommand = "xfce4-terminal";
                args = [
                    "--command"
                ];
                break;

            case "pantheon-terminal":
                terminalCommand = "pantheon-terminal";
                args = [
                    "-e"
                ];
                break;
            case "URxvt":
                terminalCommand = "urxvt";
                args = [
                    "-e"
                ];
                break;

            case "MATE Terminal":
                terminalCommand = "mate-terminal";
                args = [
                    "--command"
                ];
            break;

            default:
                terminalCommand = "xterm";
                args = [
                    "-e"
                ];
        }

        child_process.spawn(terminalCommand, [...args, compiledPath], options)
    }
    if(process.platform === "win32"){
        const command = `start "${filePath.name}" cmd /C ${compiledPath} & echo.`;
        child_process.exec(command, options);
    }
    else if (process.platform === "darwin") {
        child_process.spawn("open", [compiledPath], options);
    }
}


function nextErr(){
    curErr++;

    for(var i = 0; i < errs.length; curErr++, i++){
        if(curErr >= errs.length) curErr = 0;
        if(parseErr()){
          break;
        }
    }
}

function prevErr(){
    curErr--;

    for(var i = 0; i < errs.length; curErr--, i++){
        if(curErr < 0) curErr = errs.length - 1;

        if(parseErr()){
          break;
        }
    }
}

function parseErr(){
    var res = errs[curErr].split(':');

    var path = "";
    var i = 0;

    while(i < res.length && isNaN(res[i])){
        if(i > 0) path+=":";
        path+=res[i];
        i++;
    }
    if(i >= res.length-1){
        return 0;
    }
    if(isNaN(res[i+1])){
        return 0;
    }
    var row = Number(res[i]) - 1;
    var column = Number(res[i+1]) - 1;
    const position = new Point(row, column);

    const editor = atom.workspace.getActivePaneItem();
    editor.setCursorBufferPosition(position);

    return 1;
}
