#!/usr/bin/env node
"use strict";

// Compile the classic scripts into one lexical scope without duplicating
// the CPU or emulating the browser DOM.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseArgs } = require("node:util");

const blockSize = 1024 * 1024;

function createMachine(options = {}) {
    const mediaDir = path.resolve(options.mediaDir || ".");
    const output = options.output || (() => {});
    const printer = options.printer || (() => {});
    const reportError = options.reportError || (() => {});
    const timers = new Set();
    let closed = false;

    function timeout(fn, delay, ...args) {
        if (closed) return;
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (!closed) fn(...args);
        }, delay);
        timers.add(timer);
        return timer;
    }

    function interval(fn, delay) {
        const timer = setInterval(fn, delay);
        timers.add(timer);
        return timer;
    }

    const panel = { addressSwitches: 0, dataSwitches: 0, operatingSwitches: 0 };
    const host = {
        console: options.console || console,
        setTimeout: timeout,
        setInterval: interval,
        panel,
        updateAddressSwitches: value => { panel.addressSwitches = value; },
        updateDataSwitches: value => { panel.dataSwitches = value; },
        updateOperatingSwitches: (value, mask) => {
            panel.operatingSwitches = (panel.operatingSwitches & ~mask) | (value & mask);
        },
        vt52Put: (unit, ch) => output(String.fromCharCode(ch))
    };
    // Contextified global lookups in the instruction interpreter are much
    // slower than ordinary lexical variables. Compile once per machine in
    // the current realm; only host callbacks and diagnostic exports cross
    // the boundary. The browser scripts themselves remain unchanged.
    const source = ["fpp10.js", "pdp10.js", "io.js", "boot.js"]
        .map(name => fs.readFileSync(path.join(__dirname, name), "utf8"))
        .join("\n");
    const exportsSource = `
        return {
            CPU, RP03, tty, pi, apr, pag, mtc, mts, lpt, panel, log,
            main, ttyInput, bootLoad, resetCPU, XCT, getWordByVirtual,
            mapVirtualToPhysical, readWordByPhysical, writeWordByPhysical,
            extractXHR, getData, diskIO, ioLPT, ioAPR, ioTTY, ioDPC,
            get diskBlockReader() { return diskBlockReader; },
            set diskBlockReader(fn) { diskBlockReader = fn; },
            get printerOutput() { return printerOutput; },
            set printerOutput(fn) { printerOutput = fn; }
        };
    `;
    const context = vm.compileFunction(source + exportsSource,
        Object.keys(host), { filename: path.join(__dirname, "node-runtime.js") })
        (...Object.values(host));

    // Read a single SIMH image block. extractXHR() pads a short final block.
    context.diskBlockReader = async (name, block, done) => {
        let file, result;
        try {
            file = await fs.promises.open(path.join(mediaDir, name), "r");
            const data = Buffer.alloc(blockSize);
            let length = 0;
            while (length < blockSize) {
                const { bytesRead } = await file.read(data, length,
                    blockSize - length, block * blockSize + length);
                if (!bytesRead) break;
                length += bytesRead;
            }
            result = { status: length ? 206 : 416, response: data.subarray(0, length) };
        } catch (error) {
            reportError(error.message);
            result = { status: 500 };
        } finally {
            if (file) {
                try {
                    await file.close();
                } catch (error) {
                    reportError(error.message);
                    result = { status: 500 };
                }
            }
        }
        if (!closed) done(result);
    };
    context.printerOutput = printer;

    // Preserve type-ahead while the emulated CTY input register is busy.
    let pending = "";
    let inputTimer = false;
    function drainInput() {
        inputTimer = false;
        while (pending.length && context.ttyInput(0, pending.charCodeAt(0))) {
            pending = pending.slice(1);
        }
        if (pending.length && !closed) {
            inputTimer = true;
            timeout(drainInput, 5);
        }
    }

    return {
        context,
        start() { context.main(); },
        input(text) {
            if (closed) return;
            if (text.charCodeAt(0) === 3) pending = "";
            pending += text;
            if (!inputTimer) drainInput();
        },
        close() {
            closed = true;
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
        }
    };
}

function cli() {
    const { values } = parseArgs({
        options: {
            help: { type: "boolean", short: "h" },
            "media-dir": { type: "string", default: "." },
            printer: { type: "string" }
        }
    });
    if (values.help) {
        process.stdout.write(
            "Usage: node node.js [--media-dir DIR] [--printer FILE]\n" +
            "RP03 images: dpa0.dsk ... dpa7.dsk; tapes: mta0.tap ... mta2.tap.\n" +
            "Images are read-only; guest disk changes live in memory.\n" +
            "Ctrl-] exits; Ctrl-C is sent to the guest on a raw terminal.\n");
        return;
    }

    const printerFd = values.printer === undefined ? null :
        fs.openSync(values.printer, "a");
    const input = process.stdin;
    let machine;
    let stopped = false;
    function stop() {
        if (stopped) return;
        stopped = true;
        if (machine) machine.close();
        if (input.isTTY && input.isRaw) input.setRawMode(false);
        input.pause();
        if (printerFd !== null) fs.closeSync(printerFd);
    }
    process.once("exit", stop);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);

    machine = createMachine({
        mediaDir: values["media-dir"],
        output: text => process.stdout.write(text),
        printer: text => {
            if (printerFd !== null) fs.writeSync(printerFd, text);
            else process.stderr.write(text);
        },
        reportError: message => process.stderr.write("Image I/O: " + message + "\n"),
        console: { log: (...args) => console.error(...args) }
    });
    if (input.isTTY) input.setRawMode(true);
    input.on("data", data => {
        // Convert LF from redirected input to the guest's RETURN key.
        let text = "";
        for (const byte of data) {
            if (input.isTTY && byte === 29) {
                stop();
                return;
            }
            if (byte < 128) text += String.fromCharCode(byte === 10 && !input.isTTY ? 13 : byte);
        }
        machine.input(text);
    });
    input.resume();
    machine.start();
}

module.exports = { createMachine };
if (require.main === module) {
    try {
        cli();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
