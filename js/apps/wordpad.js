// WordPad-style rich text editor.
//
// - Editing: a contenteditable area + document.execCommand (deprecated on
//   paper, but it is still the one API that works the same on desktop and
//   mobile browsers for bold/italic/lists/alignment/undo).
// - Saving: the document is converted to a real .rtf file (the format the
//   original WordPad used) or to plain .txt. Nothing is uploaded anywhere -
//   the file is built in the browser and downloaded.
// - Opening: .rtf (basic reader: text, bold/italic/underline/strike,
//   sub/superscript, font, size, colours, highlight, alignment, indents,
//   bullet/numbered lists) and .txt.
// - Draft: the document is autosaved to localStorage ('wordpad_draft') so an
//   accidental reload/close doesn't lose it. All windows share that one draft
//   (same idea as Notepad's single shared document).
//
// The RTF writer/reader are plain functions on window.WordpadRtf (no UI
// involved) so they can be tested outside a browser.
(function () {
    'use strict';

    const DEFAULT_FONT = 'Calibri';
    const DEFAULT_PT = 11;
    const DEFAULT_HALF_PT = DEFAULT_PT * 2;
    const DRAFT_KEY = 'wordpad_draft';
    const FONT_LIST = ['Calibri', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Comic Sans MS'];
    const SIZE_LIST = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
    const MAX_OPEN_BYTES = 5 * 1024 * 1024;

    // =====================================================================
    // Colour / length helpers
    // =====================================================================
    const NAMED_COLORS = {
        black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
        blue: [0, 0, 255], yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128],
        gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], navy: [0, 0, 128],
        maroon: [128, 0, 0], teal: [0, 128, 128], lime: [0, 255, 0], aqua: [0, 255, 255],
        fuchsia: [255, 0, 255], magenta: [255, 0, 255], cyan: [0, 255, 255], olive: [128, 128, 0]
    };

    // Returns [r,g,b] or null (also null for transparent / unparseable).
    function parseColor(str) {
        if (!str) return null;
        const s = String(str).trim().toLowerCase();
        if (!s || s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'currentcolor') return null;
        let m = s.match(/^#([0-9a-f]{3})$/);
        if (m) return m[1].split('').map(function (h) { return parseInt(h + h, 16); });
        m = s.match(/^#([0-9a-f]{6})$/);
        if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
        m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
        if (m) {
            if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
            return [Math.min(255, +m[1]), Math.min(255, +m[2]), Math.min(255, +m[3])];
        }
        if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, s)) return NAMED_COLORS[s].slice();
        return null;
    }

    // CSS length -> twips (1/1440 inch). Returns 0 if not understood.
    function lengthToTwips(str) {
        if (!str) return 0;
        const m = String(str).trim().match(/^(-?[\d.]+)\s*(px|pt|in|cm|mm|em)?$/i);
        if (!m) return 0;
        const v = parseFloat(m[1]);
        if (!isFinite(v)) return 0;
        const unit = (m[2] || 'px').toLowerCase();
        const factor = { px: 15, pt: 20, in: 1440, cm: 567, mm: 56.7, em: 240 }[unit];
        return Math.max(0, Math.round(v * factor));
    }

    // CSS font-size -> points (number) or 0.
    const KEYWORD_PT = { 'xx-small': 7, 'x-small': 8, small: 10, medium: 12, large: 14, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 };
    const FONT_TAG_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
    function sizeToPt(str) {
        if (!str) return 0;
        const s = String(str).trim().toLowerCase();
        if (KEYWORD_PT[s]) return KEYWORD_PT[s];
        const m = s.match(/^([\d.]+)\s*(pt|px)$/);
        if (!m) return 0;
        const v = parseFloat(m[1]);
        return m[2] === 'pt' ? v : v * 0.75;
    }

    function firstFamily(str) {
        if (!str) return '';
        const first = String(str).split(',')[0].trim().replace(/^["']|["']$/g, '');
        return first.replace(/[;{}\\"]/g, '').trim();
    }

    // =====================================================================
    // RTF writer
    // =====================================================================
    function rtfEscape(text) {
        let o = '';
        for (let k = 0; k < text.length; k++) {
            const c = text.charCodeAt(k);
            if (c === 92) o += '\\\\';
            else if (c === 123) o += '\\{';
            else if (c === 125) o += '\\}';
            else if (c === 9) o += '\\tab ';
            else if (c === 160) o += '\\~';
            else if (c === 10 || c === 13) o += ' ';
            else if (c < 32) { /* drop other control characters */ }
            else if (c < 127) o += text.charAt(k);
            else o += '\\u' + (c > 32767 ? c - 65536 : c) + '?';
        }
        return o;
    }

    function guessFamily(name) {
        if (/times|georgia|garamond|cambria|palatino|book|serif/i.test(name) && !/sans/i.test(name)) return 'froman';
        if (/courier|consolas|mono|lucida console/i.test(name)) return 'fmodern';
        if (/comic|script|brush/i.test(name)) return 'fscript';
        return 'fswiss';
    }

    const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE',
        'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);

    function htmlToRtf(root) {
        const fontTable = [
            { name: DEFAULT_FONT, fam: 'fswiss', charset: 0 },
            { name: 'Symbol', fam: 'fnil', charset: 2 }   // f1 is reserved for list bullets
        ];
        const fontIdx = {};
        fontIdx[DEFAULT_FONT.toLowerCase()] = 0;
        const colorTable = [];
        const colorIdx = {};

        function fontNo(name) {
            const key = name.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(fontIdx, key)) return fontIdx[key];
            fontTable.push({ name: name, fam: guessFamily(name), charset: 0 });
            fontIdx[key] = fontTable.length - 1;
            return fontIdx[key];
        }
        function colorNo(rgb) {
            const key = rgb.join(',');
            if (!Object.prototype.hasOwnProperty.call(colorIdx, key)) {
                colorTable.push(rgb);
                colorIdx[key] = colorTable.length; // index 0 is the "auto" colour
            }
            return colorIdx[key];
        }

        const paras = [];
        let runs = '';
        let hasContent = false;
        let pendingBreaks = 0;
        let props = { align: '', baseLi: 0, li: 0, list: null, listUsed: false };
        const listStack = [];

        function flushPara() {
            if (hasContent && pendingBreaks > 1) runs += '\\line '.repeat(pendingBreaks - 1);
            let s = '\\pard';
            const isList = props.list && !props.listUsed;
            if (isList) {
                s += props.list.type === 'ol'
                    ? '{\\pntext\\f0 ' + props.list.num + '.\\tab}{\\*\\pn\\pnlvlbody\\pnf0\\pnindent0\\pnstart' + props.list.num + '\\pndec{\\pntxta.}}'
                    : '{\\pntext\\f1\\\'B7\\tab}{\\*\\pn\\pnlvlblt\\pnf1\\pnindent0{\\pntxtb\\\'B7}}';
                props.listUsed = true;
            }
            const li = props.list ? props.li : props.baseLi;
            const fi = isList ? -360 : 0;
            if (fi) s += '\\fi' + fi;
            if (li) s += '\\li' + li;
            s += ({ left: '\\ql', center: '\\qc', right: '\\qr', justify: '\\qj' }[props.align] || '');
            s += ' ' + runs + '\\par\n';
            paras.push(s);
            runs = '';
            hasContent = false;
            pendingBreaks = 0;
        }

        function addRun(text, ctx) {
            if (!text) return;
            if (pendingBreaks) { runs += '\\line '.repeat(pendingBreaks); pendingBreaks = 0; }
            let ctl = '';
            if (ctx.face) { const n = fontNo(ctx.face); if (n !== 0) ctl += '\\f' + n; }
            if (ctx.half && ctx.half !== DEFAULT_HALF_PT) ctl += '\\fs' + ctx.half;
            if (ctx.b) ctl += '\\b';
            if (ctx.i) ctl += '\\i';
            if (ctx.u) ctl += '\\ul';
            if (ctx.s) ctl += '\\strike';
            if (ctx.sup) ctl += '\\super';
            else if (ctx.sub) ctl += '\\sub';
            if (ctx.color) ctl += '\\cf' + colorNo(ctx.color);
            if (ctx.bg) ctl += '\\highlight' + colorNo(ctx.bg);
            const body = rtfEscape(text);
            runs += ctl ? '{' + ctl + ' ' + body + '}' : body;
            hasContent = true;
        }

        function addText(text, ctx) {
            if (!text) return;
            const parts = text.split(/\r\n|\r|\n/);
            parts.forEach(function (part, idx) {
                if (idx > 0) pendingBreaks++;
                addRun(part, ctx);
            });
        }

        function deriveCtx(el, ctx) {
            const c = Object.assign({}, ctx);
            const tag = el.tagName;
            if (tag === 'B' || tag === 'STRONG') c.b = true;
            else if (tag === 'I' || tag === 'EM') c.i = true;
            else if (tag === 'U') c.u = true;
            else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') c.s = true;
            else if (tag === 'SUB') { c.sub = true; c.sup = false; }
            else if (tag === 'SUP') { c.sup = true; c.sub = false; }
            else if (tag === 'FONT') {
                const face = firstFamily(el.getAttribute('face'));
                if (face) c.face = face;
                const sz = FONT_TAG_PT[el.getAttribute('size')];
                if (sz) c.half = sz * 2;
                const col = parseColor(el.getAttribute('color'));
                if (col) c.color = col;
            }
            const st = el.style;
            if (st) {
                const fw = (st.fontWeight || '').toLowerCase();
                if (fw) c.b = (fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600);
                const fs = (st.fontStyle || '').toLowerCase();
                if (fs) c.i = (fs === 'italic' || fs === 'oblique');
                const styleAttr = el.getAttribute('style') || '';
                if (/text-decoration[^;]*underline/i.test(styleAttr)) c.u = true;
                if (/text-decoration[^;]*line-through/i.test(styleAttr)) c.s = true;
                const pt = sizeToPt(st.fontSize);
                if (pt) c.half = Math.max(2, Math.round(pt * 2));
                const fam = firstFamily(st.fontFamily);
                if (fam) c.face = fam;
                const col = parseColor(st.color);
                if (col) c.color = col;
                const bg = parseColor(st.backgroundColor);
                if (bg) c.bg = bg;
            }
            return c;
        }

        function readAlign(el) {
            const a = ((el.style && el.style.textAlign) || el.getAttribute('align') || '').toLowerCase();
            return (a === 'left' || a === 'center' || a === 'right' || a === 'justify') ? a : '';
        }

        function walkBlock(el, ctx, tag) {
            if (hasContent) flushPara();
            const saved = props;
            const p = Object.assign({}, saved);
            p.list = null;
            p.listUsed = false;
            const al = readAlign(el);
            if (al) p.align = al;
            let indent = el.style ? lengthToTwips(el.style.marginLeft) : 0;
            if (tag === 'BLOCKQUOTE' && !(el.style && el.style.marginLeft)) indent = 600; // browser default 40px
            p.baseLi = saved.baseLi + indent;
            p.li = p.baseLi;

            const isList = (tag === 'UL' || tag === 'OL');
            if (isList) listStack.push({ type: tag === 'OL' ? 'ol' : 'ul', num: 0 });
            if (tag === 'LI') {
                const top = listStack.length ? listStack[listStack.length - 1] : { type: 'ul', num: 0 };
                top.num++;
                p.list = { type: top.type, num: top.num };
                p.li = p.baseLi + 720 + 360 * Math.max(0, listStack.length - 1);
            }

            props = p;
            const before = paras.length;
            Array.prototype.forEach.call(el.childNodes, function (child) { walk(child, ctx); });
            if (hasContent) flushPara();
            else if (paras.length === before && !isList) { pendingBreaks = 0; flushPara(); } // an empty block is a blank line
            if (isList) listStack.pop();
            props = saved;
        }

        function walk(node, ctx) {
            if (node.nodeType === 3) { addText(node.nodeValue, ctx); return; }
            if (node.nodeType !== 1) return;
            const tag = node.tagName;
            if (tag === 'BR') { pendingBreaks++; return; }
            if (tag === 'SCRIPT' || tag === 'STYLE') return;
            const c = deriveCtx(node, ctx);
            if (BLOCK_TAGS.has(tag)) walkBlock(node, c, tag);
            else Array.prototype.forEach.call(node.childNodes, function (child) { walk(child, c); });
        }

        Array.prototype.forEach.call(root.childNodes, function (child) { walk(child, {}); });
        if (hasContent || pendingBreaks) flushPara();
        if (!paras.length) flushPara();

        const fonttbl = fontTable.map(function (f, idx) {
            return '{\\f' + idx + '\\' + f.fam + '\\fcharset' + f.charset + ' ' + rtfEscape(f.name.replace(/[;{}\\]/g, '')) + ';}';
        }).join('');
        const colortbl = '{\\colortbl ;' + colorTable.map(function (c) {
            return '\\red' + c[0] + '\\green' + c[1] + '\\blue' + c[2] + ';';
        }).join('') + '}';

        return '{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1040\\uc1'
            + '{\\fonttbl' + fonttbl + '}'
            + colortbl
            + '\\paperw11906\\paperh16838\\margl1417\\margr1417\\margt1417\\margb1417\\viewkind4\\f0\\fs' + DEFAULT_HALF_PT + '\n'
            + paras.join('')
            + '}\n';
    }

    // =====================================================================
    // RTF reader  (RTF text -> DocumentFragment of <div>/<ul>/<ol>/<li>)
    // =====================================================================
    const CP1252_HIGH = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
        0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];
    const SKIP_DESTS = new Set(['stylesheet', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
        'pict', 'object', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'themedata', 'colorschememapping', 'latentstyles',
        'datastore', 'xmlnstbl', 'generator', 'fldinst', 'bkmkstart', 'bkmkend', 'footnote', 'annotation', 'private', 'wgrffmtfilter',
        'nonshppict', 'shpinst', 'shprslt', 'mmathPr', 'defchp', 'defpap', 'pgdsctbl', 'userprops', 'filetbl', 'fchars', 'lchars', 'ftnsep', 'ftnsepc']);
    const SPECIAL_CHARS = {
        emdash: '\u2014', endash: '\u2013', bullet: '\u2022', lquote: '\u2018', rquote: '\u2019',
        ldblquote: '\u201C', rdblquote: '\u201D', emspace: '\u2003', enspace: '\u2002', qmspace: '\u2005'
    };

    function rtfToDom(src, doc) {
        doc = doc || document;
        if (!/^\s*\{\\rtf/.test(src)) throw new Error('Il file non sembra un documento RTF valido.');

        const n = src.length;
        let i = 0;
        const fonts = {};
        // The colour table's first entry is empty ("auto"): that leading ';'
        // is what pushes the null at index 0, so start from an empty list.
        const colors = [];
        const stack = [];
        const paras = [];
        let state = { b: false, i: false, u: false, s: false, sup: false, sub: false, fs: 24, f: 0, cf: 0, hl: 0, uc: 1, skip: 0, dest: null };
        let cur = { align: '', li: 0, fi: 0, list: null, runs: [] };
        let fontNo = 0, fontBuf = '';
        let rgb = { r: null, g: null, b: null };
        let markerBuf = '';
        let groupStart = false;

        function fmtKey() {
            return [state.b, state.i, state.u, state.s, state.sup, state.sub, state.fs, state.f, state.cf, state.hl].join('|');
        }
        function addRun(text) {
            const key = fmtKey();
            const last = cur.runs[cur.runs.length - 1];
            if (last && last.key === key) { last.text += text; return; }
            cur.runs.push({ key: key, text: text, b: state.b, i: state.i, u: state.u, s: state.s, sup: state.sup, sub: state.sub,
                fs: state.fs, f: state.f, cf: state.cf, hl: state.hl });
        }
        function emit(text) {
            if (!text) return;
            if (state.dest === 'skip' || state.dest === 'colortbl') return;
            if (state.dest === 'fonttbl') { fontBuf += text; return; }
            if (state.dest === 'marker') { markerBuf += text; return; }
            addRun(text);
        }
        function endParagraph() {
            paras.push(cur);
            // paragraph properties carry over to the next paragraph until \pard
            cur = { align: cur.align, li: cur.li, fi: cur.fi, list: null, runs: [] };
        }
        function finishMarker() {
            const t = markerBuf.replace(/\s+/g, '');
            markerBuf = '';
            if (!t) return;
            if (/^[\u2022\u00B7\uF0B7\uF0A7\u25AA\u25E6\u2023\u25CF\u25CB\u25A0\u25A1o*\-\u2013\u2014]$/.test(t)) {
                cur.list = { type: 'ul', start: 1 };
            } else if (/^\(?[0-9]+[.)]?$/.test(t) || /^\(?[a-zA-Z]{1,4}[.)]$/.test(t)) {
                const num = parseInt(t.replace(/\D/g, ''), 10);
                cur.list = { type: 'ol', start: isFinite(num) && num > 0 ? num : 1 };
            }
        }
        function hexChar(code) {
            if (code >= 0x80 && code <= 0x9F) return String.fromCharCode(CP1252_HIGH[code - 0x80]);
            return String.fromCharCode(code);
        }

        while (i < n) {
            const ch = src.charAt(i);

            if (ch === '{') {
                stack.push(state);
                state = Object.assign({}, state);
                groupStart = true;
                i++;
                continue;
            }
            if (ch === '}') {
                if (state.dest === 'marker' && stack.length && stack[stack.length - 1].dest !== 'marker') finishMarker();
                if (stack.length) state = stack.pop();
                groupStart = false;
                i++;
                continue;
            }
            if (ch === '\r' || ch === '\n') { i++; continue; }

            if (ch !== '\\') {
                groupStart = false;
                i++;
                if (state.skip > 0) { state.skip--; continue; }
                if (state.dest === 'fonttbl' && ch === ';') { fonts[fontNo] = fontBuf.trim(); fontBuf = ''; continue; }
                if (state.dest === 'colortbl' && ch === ';') {
                    colors.push(rgb.r === null && rgb.g === null && rgb.b === null ? null
                        : 'rgb(' + (rgb.r || 0) + ', ' + (rgb.g || 0) + ', ' + (rgb.b || 0) + ')');
                    rgb = { r: null, g: null, b: null };
                    continue;
                }
                emit(ch);
                continue;
            }

            // ---- control sequence ----
            i++;
            if (i >= n) break;
            const c = src.charAt(i);

            if (!/[a-zA-Z]/.test(c)) {
                i++;
                if (c === '*') { if (groupStart) state.dest = 'skip'; groupStart = false; continue; }
                groupStart = false;
                if (c === '\'') {
                    const hex = src.substr(i, 2);
                    i += 2;
                    if (state.skip > 0) { state.skip--; continue; }
                    const code = parseInt(hex, 16);
                    if (isFinite(code)) emit(hexChar(code));
                } else if (c === '\\' || c === '{' || c === '}') {
                    if (state.skip > 0) { state.skip--; continue; }
                    emit(c);
                } else if (c === '~') emit('\u00A0');
                else if (c === '_') emit('\u2011');
                else if (c === '\r' || c === '\n') { if (state.dest === null) endParagraph(); }
                continue;
            }

            let j = i;
            while (j < n && /[a-zA-Z]/.test(src.charAt(j))) j++;
            const word = src.slice(i, j);
            let param = null;
            let k = j;
            if (src.charAt(k) === '-') k++;
            const ds = k;
            while (k < n && /[0-9]/.test(src.charAt(k))) k++;
            if (k > ds) param = parseInt(src.slice(j, k), 10);
            else k = j;
            if (src.charAt(k) === ' ') k++; // a single space after a control word is just its delimiter
            i = k;

            if (groupStart) {
                groupStart = false;
                if (word === 'fonttbl') { state.dest = 'fonttbl'; fontBuf = ''; continue; }
                if (word === 'colortbl') { state.dest = 'colortbl'; rgb = { r: null, g: null, b: null }; continue; }
                if (word === 'pntext' || word === 'listtext') { state.dest = 'marker'; markerBuf = ''; continue; }
                if (SKIP_DESTS.has(word)) { state.dest = 'skip'; continue; }
            }

            if (state.dest === 'fonttbl') { if (word === 'f' && param !== null) fontNo = param; continue; }
            if (state.dest === 'colortbl') {
                if (word === 'red') rgb.r = Math.min(255, param || 0);
                else if (word === 'green') rgb.g = Math.min(255, param || 0);
                else if (word === 'blue') rgb.b = Math.min(255, param || 0);
                continue;
            }
            if (state.dest === 'skip') continue;

            switch (word) {
                case 'par': if (state.dest === null) endParagraph(); break;
                case 'pard': cur.align = ''; cur.li = 0; cur.fi = 0; cur.list = null; break;
                case 'plain': state.b = state.i = state.u = state.s = state.sup = state.sub = false; state.cf = 0; state.hl = 0; break;
                case 'b': state.b = param !== 0; break;
                case 'i': state.i = param !== 0; break;
                case 'strike': case 'striked': state.s = param !== 0; break;
                case 'super': state.sup = true; state.sub = false; break;
                case 'sub': state.sub = true; state.sup = false; break;
                case 'nosupersub': state.sup = state.sub = false; break;
                case 'fs': if (param !== null) state.fs = param; break;
                case 'f': if (param !== null) state.f = param; break;
                case 'cf': state.cf = param || 0; break;
                case 'highlight': state.hl = param || 0; break;
                case 'ql': cur.align = ''; break;
                case 'qc': cur.align = 'center'; break;
                case 'qr': cur.align = 'right'; break;
                case 'qj': cur.align = 'justify'; break;
                case 'li': cur.li = param || 0; break;
                case 'fi': cur.fi = param || 0; break;
                case 'uc': state.uc = param === null ? 1 : param; break;
                case 'tab': emit('\t'); break;
                case 'line': emit('\n'); break;
                case 'u': {
                    let code = param === null ? 63 : param;
                    if (code < 0) code += 65536;
                    if (state.skip > 0) state.skip--; else emit(String.fromCharCode(code));
                    state.skip = state.uc;
                    break;
                }
                default:
                    if (word === 'ulnone') state.u = false;
                    else if (/^ul(?!c$)/.test(word)) state.u = param !== 0;
                    else if (Object.prototype.hasOwnProperty.call(SPECIAL_CHARS, word)) emit(SPECIAL_CHARS[word]);
            }
        }

        if (cur.runs.length) paras.push(cur);

        // ---- build the DOM ----
        const frag = doc.createDocumentFragment();
        let listEl = null, listType = null;

        function cssFor(r) {
            const css = [];
            if (r.b) css.push('font-weight: bold');
            if (r.i) css.push('font-style: italic');
            const deco = [];
            if (r.u) deco.push('underline');
            if (r.s) deco.push('line-through');
            if (deco.length) css.push('text-decoration: ' + deco.join(' '));
            if (r.fs && r.fs !== DEFAULT_HALF_PT) css.push('font-size: ' + (r.fs / 2) + 'pt');
            const face = fonts[r.f] ? fonts[r.f].replace(/[;{}\\"']/g, '').trim() : '';
            if (face && face.toLowerCase() !== DEFAULT_FONT.toLowerCase()) css.push('font-family: "' + face + '"');
            if (r.cf && colors[r.cf]) css.push('color: ' + colors[r.cf]);
            if (r.hl && colors[r.hl]) css.push('background-color: ' + colors[r.hl]);
            return css.join('; ');
        }
        function appendRun(block, r) {
            const css = cssFor(r);
            r.text.split('\n').forEach(function (seg, idx) {
                if (idx > 0) block.appendChild(doc.createElement('br'));
                if (!seg) return;
                let node = doc.createTextNode(seg);
                if (r.sup || r.sub) {
                    const e = doc.createElement(r.sup ? 'sup' : 'sub');
                    e.appendChild(node);
                    node = e;
                }
                if (css) {
                    const span = doc.createElement('span');
                    span.setAttribute('style', css);
                    span.appendChild(node);
                    node = span;
                }
                block.appendChild(node);
            });
        }

        paras.forEach(function (p) {
            let block;
            if (p.list) {
                if (!listEl || listType !== p.list.type) {
                    listEl = doc.createElement(p.list.type);
                    listType = p.list.type;
                    if (p.list.type === 'ol' && p.list.start > 1) listEl.setAttribute('start', String(p.list.start));
                    frag.appendChild(listEl);
                }
                block = doc.createElement('li');
                listEl.appendChild(block);
            } else {
                listEl = null;
                listType = null;
                block = doc.createElement('div');
                frag.appendChild(block);
                if (p.li > 0) block.style.marginLeft = Math.round(p.li / 15) + 'px';
                if (p.fi > 0) block.style.textIndent = Math.round(p.fi / 15) + 'px';
            }
            if (p.align) block.style.textAlign = p.align;
            if (!p.runs.length) block.appendChild(doc.createElement('br'));
            else p.runs.forEach(function (r) { appendRun(block, r); });
        });
        return frag;
    }

    window.WordpadRtf = { htmlToRtf: htmlToRtf, rtfToDom: rtfToDom, rtfEscape: rtfEscape, parseColor: parseColor };

    // =====================================================================
    // Draft sanitiser: the autosaved draft is the editor's own innerHTML.
    // It is only ever written by this app, but it is rebuilt through a
    // whitelist anyway so a corrupted/tampered value can never inject markup.
    // =====================================================================
    const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'SPAN', 'FONT',
        'DIV', 'P', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);
    const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);
    const ALLOWED_STYLE_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'font-size',
        'font-family', 'color', 'background-color', 'text-align', 'margin-left', 'text-indent']);

    function cleanStyle(str) {
        return String(str).split(';').map(function (decl) {
            const k = decl.indexOf(':');
            if (k < 0) return '';
            const prop = decl.slice(0, k).trim().toLowerCase();
            const val = decl.slice(k + 1).trim();
            if (!ALLOWED_STYLE_PROPS.has(prop)) return '';
            if (/url\s*\(|expression|javascript|@import|[<>\\]/i.test(val)) return '';
            return prop + ': ' + val;
        }).filter(Boolean).join('; ');
    }

    function cloneClean(node, target) {
        if (node.nodeType === 3) { target.appendChild(document.createTextNode(node.nodeValue)); return; }
        if (node.nodeType !== 1) return;
        const tag = node.tagName;
        if (DROP_WITH_CONTENT.has(tag)) return;
        if (!ALLOWED_TAGS.has(tag)) {
            Array.prototype.forEach.call(node.childNodes, function (c) { cloneClean(c, target); });
            return;
        }
        const el = document.createElement(tag.toLowerCase());
        const style = node.getAttribute('style');
        if (style) { const s = cleanStyle(style); if (s) el.setAttribute('style', s); }
        if (tag === 'FONT') {
            const color = node.getAttribute('color');
            if (color && /^[#0-9a-z(),.\s%]+$/i.test(color)) el.setAttribute('color', color);
            const size = node.getAttribute('size');
            if (size && /^[1-7]$/.test(size)) el.setAttribute('size', size);
            const face = firstFamily(node.getAttribute('face'));
            if (face) el.setAttribute('face', face);
        }
        const align = (node.getAttribute('align') || '').toLowerCase();
        if (/^(left|center|right|justify)$/.test(align)) el.setAttribute('align', align);
        Array.prototype.forEach.call(node.childNodes, function (c) { cloneClean(c, el); });
        target.appendChild(el);
    }

    function setSanitizedHtml(editor, html) {
        editor.textContent = '';
        const parsed = new DOMParser().parseFromString(String(html), 'text/html');
        Array.prototype.forEach.call(parsed.body.childNodes, function (c) { cloneClean(c, editor); });
    }

    // =====================================================================
    // File helpers
    // =====================================================================
    function safeFileName(name) {
        const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/\.(rtf|txt)$/i, '');
        return (cleaned || 'Documento').slice(0, 80);
    }
    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
    // Text files in the wild are either UTF-8 or (older) Windows-1252.
    function decodeText(buffer) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch (e) { return new TextDecoder('windows-1252').decode(buffer); }
    }
    function showError(title, msg) {
        if (window.showErrorDialog) window.showErrorDialog(title, msg, 'error');
        else console.error(title + ': ' + msg);
    }

    // =====================================================================
    // The app
    // =====================================================================
    function ensureStyles() {
        if (document.getElementById('wp-styles')) return;
        const st = document.createElement('style');
        st.id = 'wp-styles';
        st.textContent = [
            '.wp-root{display:flex;flex-direction:column;height:100%;background:#d4d0c8;font:12px Tahoma,"Segoe UI",sans-serif;color:#000;box-sizing:border-box;}',
            '.wp-row{display:flex;flex-wrap:wrap;gap:3px;align-items:center;padding:3px 4px;border-bottom:1px solid #808080;}',
            '.wp-btn{-webkit-appearance:none;appearance:none;background:#d4d0c8;color:#000;border:2px solid;border-color:#fff #404040 #404040 #fff;',
            'padding:2px 6px;min-width:28px;height:28px;font:12px Tahoma,"Segoe UI",sans-serif;cursor:pointer;touch-action:manipulation;border-radius:0;}',
            '.wp-btn.active{border-color:#404040 #fff #fff #404040;background:#bdb9ae;}',
            '.wp-btn:active{border-color:#404040 #fff #fff #404040;}',
            '.wp-sel,.wp-name{height:28px;font:12px Tahoma,"Segoe UI",sans-serif;background:#fff;color:#000;border:2px inset #808080;box-sizing:border-box;border-radius:0;}',
            '.wp-name{flex:1;min-width:90px;padding:0 4px;}',
            '.wp-color{width:30px;height:28px;padding:0;border:2px outset #fff;background:#d4d0c8;cursor:pointer;}',
            '.wp-sep{width:1px;height:22px;background:#808080;margin:0 2px;}',
            '.wp-page{flex:1;min-height:0;overflow:auto;background:#808080;padding:6px;}',
            '.wp-editor{min-height:100%;box-sizing:border-box;background:#fff;color:#000;padding:14px 16px;outline:none;white-space:pre-wrap;word-wrap:break-word;',
            'overflow-wrap:anywhere;font-family:Calibri,Carlito,Arial,sans-serif;font-size:' + DEFAULT_PT + 'pt;line-height:1.25;tab-size:4;-moz-tab-size:4;}',
            '.wp-editor ul,.wp-editor ol{margin:0;padding-left:34px;}',
            '.wp-editor blockquote{margin:0 0 0 40px;border:none;padding:0;}',
            '.wp-status{display:flex;justify-content:space-between;gap:8px;padding:2px 6px;border-top:1px solid #fff;font-size:11px;color:#202020;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    window.initWordpad = function (container, winId) {
        ensureStyles();

        const root = document.createElement('div');
        root.className = 'wp-root';
        root.innerHTML =
            '<div class="wp-row wp-file-row"></div>' +
            '<div class="wp-row wp-fmt-row"></div>' +
            '<div class="wp-row wp-fmt-row2"></div>' +
            '<div class="wp-page"><div class="wp-editor" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true"></div></div>' +
            '<div class="wp-status"><span class="wp-counts"></span><span class="wp-note"></span></div>';
        container.appendChild(root);

        const fileRow = root.querySelector('.wp-file-row');
        const fmtRow = root.querySelector('.wp-fmt-row');
        const fmtRow2 = root.querySelector('.wp-fmt-row2');
        const editor = root.querySelector('.wp-editor');
        const countsEl = root.querySelector('.wp-counts');
        const noteEl = root.querySelector('.wp-note');

        // ---------- selection handling ----------
        // Toolbar <select>/<input type=color> steal focus (and on phones even
        // plain buttons can), so the last selection inside the editor is
        // remembered and put back before every command is run.
        let savedRange = null;
        function saveSelection() {
            const sel = window.getSelection();
            if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
        }
        function restoreSelection() {
            editor.focus();
            const sel = window.getSelection();
            if (!sel) return;
            if (savedRange && editor.contains(savedRange.startContainer)) {
                sel.removeAllRanges();
                sel.addRange(savedRange);
            } else {
                const r = document.createRange();
                r.selectNodeContents(editor);
                r.collapse(false);
                sel.removeAllRanges();
                sel.addRange(r);
            }
        }

        // ---------- toolbar construction ----------
        const toggles = []; // {cmd, btn}
        function mkBtn(parent, label, title, onClick, stateCmd) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wp-btn';
            b.innerHTML = label;
            b.title = title;
            b.setAttribute('aria-label', title);
            // keep the editor's focus/selection when a button is pressed
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', onClick);
            parent.appendChild(b);
            if (stateCmd) toggles.push({ cmd: stateCmd, btn: b });
            return b;
        }
        function sep(parent) { const s = document.createElement('span'); s.className = 'wp-sep'; parent.appendChild(s); }

        function exec(cmd, val) {
            restoreSelection();
            try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
            document.execCommand(cmd, false, val === undefined ? null : val);
            saveSelection();
            afterEdit();
        }

        // font size: execCommand only knows sizes 1-7, so ask for size 7 and
        // swap the resulting <font size=7> for a span with the exact point size
        let pendingPt = 0;
        function convertSizeMarkers() {
            if (!pendingPt) return;
            editor.querySelectorAll('font[size="7"]').forEach(function (f) {
                const span = document.createElement('span');
                span.style.fontSize = pendingPt + 'pt';
                while (f.firstChild) span.appendChild(f.firstChild);
                f.parentNode.replaceChild(span, f);
            });
        }
        function applySize(pt) {
            restoreSelection();
            pendingPt = pt;
            try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
            document.execCommand('fontSize', false, '7');
            try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
            convertSizeMarkers();
            saveSelection();
            afterEdit();
        }

        // --- file row ---
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.rtf,.txt,text/plain,application/rtf,text/rtf';
        fileInput.style.display = 'none';
        root.appendChild(fileInput);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wp-name';
        nameInput.value = 'Documento';
        nameInput.setAttribute('aria-label', 'Nome del file');
        nameInput.title = 'Nome del file da salvare';

        function hasText() { return editor.innerText.replace(/\s/g, '') !== ''; }
        function sendToBin() {
            if (hasText() && window.sendToRecycleBin) window.sendToRecycleBin(editor.innerText.trim(), 'WordPad');
        }

        function newDoc() {
            sendToBin();
            editor.textContent = '';
            savedRange = null;
            nameInput.value = 'Documento';
            afterEdit();
            editor.focus();
        }
        function saveRtf() {
            try {
                const rtf = htmlToRtf(editor);
                downloadBlob(new Blob([rtf], { type: 'application/rtf' }), safeFileName(nameInput.value) + '.rtf');
                noteEl.textContent = 'Salvato come .rtf';
            } catch (e) { showError('WordPad - Salvataggio', 'Non è stato possibile creare il file RTF: ' + e.message); }
        }
        function saveTxt() {
            try {
                const text = editor.innerText.replace(/\u00a0/g, ' ').replace(/\r?\n/g, '\r\n');
                downloadBlob(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' }), safeFileName(nameInput.value) + '.txt');
                noteEl.textContent = 'Salvato come .txt';
            } catch (e) { showError('WordPad - Salvataggio', 'Non è stato possibile creare il file di testo: ' + e.message); }
        }
        function openFile(file) {
            if (!file) return;
            if (file.size > MAX_OPEN_BYTES) { showError('WordPad - Apri', 'Il file è troppo grande (massimo 5 MB).'); return; }
            const reader = new FileReader();
            reader.onerror = function () { showError('WordPad - Apri', 'Non è stato possibile leggere il file.'); };
            reader.onload = function () {
                let text;
                try { text = decodeText(reader.result); } catch (e) { showError('WordPad - Apri', 'Codifica del file non riconosciuta.'); return; }
                let frag;
                try {
                    if (/\.rtf$/i.test(file.name) || /^\s*\{\\rtf/.test(text)) {
                        frag = rtfToDom(text, document);
                    } else {
                        frag = document.createDocumentFragment();
                        text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
                            const d = document.createElement('div');
                            if (line) d.textContent = line; else d.appendChild(document.createElement('br'));
                            frag.appendChild(d);
                        });
                    }
                } catch (e) { showError('WordPad - Apri', e.message || 'File non valido.'); return; }
                sendToBin();
                editor.textContent = '';
                editor.appendChild(frag);
                savedRange = null;
                nameInput.value = safeFileName(file.name);
                afterEdit();
                noteEl.textContent = 'Aperto: ' + file.name;
            };
            reader.readAsArrayBuffer(file);
        }
        fileInput.addEventListener('change', function () {
            const f = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            openFile(f);
        });

        mkBtn(fileRow, '📄 Nuovo', 'Nuovo documento (il testo attuale va nel Cestino)', newDoc);
        mkBtn(fileRow, '📂 Apri…', 'Apri un file .rtf o .txt', function () { fileInput.click(); });
        mkBtn(fileRow, '💾 Salva .rtf', 'Scarica il documento come file RTF (Ctrl+S)', saveRtf);
        mkBtn(fileRow, 'Salva .txt', 'Scarica il documento come testo semplice', saveTxt);
        fileRow.appendChild(nameInput);

        // --- format row 1: font, size, character styles, colours ---
        const fontSel = document.createElement('select');
        fontSel.className = 'wp-sel';
        fontSel.title = 'Carattere';
        FONT_LIST.forEach(function (f) { const o = document.createElement('option'); o.value = f; o.textContent = f; fontSel.appendChild(o); });
        fontSel.addEventListener('change', function () { exec('fontName', fontSel.value); });
        fmtRow.appendChild(fontSel);

        const sizeSel = document.createElement('select');
        sizeSel.className = 'wp-sel';
        sizeSel.title = 'Dimensione';
        SIZE_LIST.forEach(function (s) { const o = document.createElement('option'); o.value = String(s); o.textContent = String(s); sizeSel.appendChild(o); });
        sizeSel.value = String(DEFAULT_PT);
        sizeSel.addEventListener('change', function () { applySize(parseInt(sizeSel.value, 10)); });
        fmtRow.appendChild(sizeSel);
        sep(fmtRow);

        mkBtn(fmtRow, '<b>G</b>', 'Grassetto (Ctrl+B)', function () { exec('bold'); }, 'bold');
        mkBtn(fmtRow, '<i>C</i>', 'Corsivo (Ctrl+I)', function () { exec('italic'); }, 'italic');
        mkBtn(fmtRow, '<u>S</u>', 'Sottolineato (Ctrl+U)', function () { exec('underline'); }, 'underline');
        mkBtn(fmtRow, '<s>B</s>', 'Barrato', function () { exec('strikeThrough'); }, 'strikeThrough');
        mkBtn(fmtRow, 'x<sub>2</sub>', 'Pedice', function () { exec('subscript'); }, 'subscript');
        mkBtn(fmtRow, 'x<sup>2</sup>', 'Apice', function () { exec('superscript'); }, 'superscript');
        sep(fmtRow);

        function mkColor(parent, title, initial, apply) {
            const wrapLabel = document.createElement('label');
            wrapLabel.title = title;
            wrapLabel.style.display = 'inline-flex';
            wrapLabel.style.alignItems = 'center';
            wrapLabel.style.gap = '2px';
            const txt = document.createElement('span');
            txt.textContent = title.charAt(0) === 'C' ? 'A' : '▮';
            txt.style.fontWeight = 'bold';
            const inp = document.createElement('input');
            inp.type = 'color';
            inp.className = 'wp-color';
            inp.value = initial;
            inp.setAttribute('aria-label', title);
            inp.addEventListener('change', function () { apply(inp.value); }); // 'change', not 'input': one span per pick, not hundreds
            wrapLabel.appendChild(txt);
            wrapLabel.appendChild(inp);
            parent.appendChild(wrapLabel);
        }
        mkColor(fmtRow, 'Colore testo', '#000000', function (v) { exec('foreColor', v); });
        mkColor(fmtRow, 'Evidenziatore', '#ffff00', function (v) {
            restoreSelection();
            try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
            if (!document.execCommand('hiliteColor', false, v)) document.execCommand('backColor', false, v);
            saveSelection();
            afterEdit();
        });

        // --- format row 2: paragraph, lists, history ---
        mkBtn(fmtRow2, '⇤', 'Allinea a sinistra', function () { exec('justifyLeft'); }, 'justifyLeft');
        mkBtn(fmtRow2, '↔', 'Centra', function () { exec('justifyCenter'); }, 'justifyCenter');
        mkBtn(fmtRow2, '⇥', 'Allinea a destra', function () { exec('justifyRight'); }, 'justifyRight');
        mkBtn(fmtRow2, '☰', 'Giustifica', function () { exec('justifyFull'); }, 'justifyFull');
        sep(fmtRow2);
        mkBtn(fmtRow2, '• Elenco', 'Elenco puntato', function () { exec('insertUnorderedList'); }, 'insertUnorderedList');
        mkBtn(fmtRow2, '1. Elenco', 'Elenco numerato', function () { exec('insertOrderedList'); }, 'insertOrderedList');
        mkBtn(fmtRow2, '◀▌', 'Riduci rientro', function () { exec('outdent'); });
        mkBtn(fmtRow2, '▐▶', 'Aumenta rientro', function () { exec('indent'); });
        sep(fmtRow2);
        mkBtn(fmtRow2, '↶', 'Annulla (Ctrl+Z)', function () { exec('undo'); });
        mkBtn(fmtRow2, '↷', 'Ripeti (Ctrl+Y)', function () { exec('redo'); });
        mkBtn(fmtRow2, '🕒', 'Inserisci data e ora', function () {
            exec('insertText', new Date().toLocaleString('it-IT'));
        });

        // ---------- state reflection ----------
        function updateState() {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return;
            toggles.forEach(function (t) {
                let on = false;
                try { on = document.queryCommandState(t.cmd); } catch (e) { /* ignore */ }
                t.btn.classList.toggle('active', !!on);
            });
            try {
                const name = String(document.queryCommandValue('fontName') || '').replace(/^["']|["']$/g, '').toLowerCase();
                const opt = Array.prototype.find.call(fontSel.options, function (o) { return o.value.toLowerCase() === name; });
                if (opt) fontSel.value = opt.value;
            } catch (e) { /* ignore */ }
            try {
                let el = sel.anchorNode;
                if (el && el.nodeType === 3) el = el.parentElement;
                if (el) {
                    const pt = Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75);
                    const best = SIZE_LIST.reduce(function (a, b) { return Math.abs(b - pt) < Math.abs(a - pt) ? b : a; }, SIZE_LIST[0]);
                    sizeSel.value = String(best);
                }
            } catch (e) { /* ignore */ }
        }
        let stateQueued = false;
        function onSelectionChange() {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return;
            saveSelection();
            if (stateQueued) return;
            stateQueued = true;
            requestAnimationFrame(function () { stateQueued = false; updateState(); });
        }
        document.addEventListener('selectionchange', onSelectionChange);

        // ---------- counts + autosave ----------
        function updateCounts() {
            const t = editor.innerText.replace(/\u00a0/g, ' ');
            const trimmed = t.trim();
            const words = trimmed ? trimmed.split(/\s+/).length : 0;
            countsEl.textContent = 'Parole: ' + words + '   Caratteri: ' + t.replace(/\n/g, '').length;
        }
        let saveTimer = null;
        function saveDraftNow() {
            clearTimeout(saveTimer);
            saveTimer = null;
            try {
                if (hasText()) {
                    localStorage.setItem(DRAFT_KEY, editor.innerHTML);
                    noteEl.textContent = 'Bozza salvata su questo dispositivo';
                } else {
                    localStorage.removeItem(DRAFT_KEY); // nothing worth keeping
                    noteEl.textContent = '';
                }
            } catch (e) {
                noteEl.textContent = '⚠ Bozza non salvata (spazio esaurito)';
            }
        }
        function afterEdit() {
            convertSizeMarkers();
            updateCounts();
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveDraftNow, 700);
        }
        editor.addEventListener('input', afterEdit);

        // ---------- editor behaviour ----------
        try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (e) { /* ignore */ }

        editor.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveRtf(); return; }
            if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                document.execCommand('insertText', false, '\t');
            }
        });
        // Paste as plain text: pasted web content would drag in arbitrary
        // markup/styles that the RTF export can't represent anyway.
        editor.addEventListener('paste', function (e) {
            e.preventDefault();
            const cd = e.clipboardData || window.clipboardData;
            const text = cd ? cd.getData('text/plain') : '';
            if (!text) return;
            text.replace(/\r\n?/g, '\n').split('\n').forEach(function (line, idx) {
                if (idx > 0) document.execCommand('insertParagraph');
                if (line) document.execCommand('insertText', false, line);
            });
        });
        // dropping a file on the page would otherwise navigate away from the desktop
        editor.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
        editor.addEventListener('drop', function (e) {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                e.preventDefault();
                openFile(e.dataTransfer.files[0]);
            }
        });

        // clicking the grey area around the "page" should put the caret in the
        // document (at the end), like a real word processor
        root.querySelector('.wp-page').addEventListener('mousedown', function (e) {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            savedRange = null;
            restoreSelection();
        });

        // ---------- restore the draft, if any ----------
        try {
            const draft = localStorage.getItem(DRAFT_KEY);
            if (draft) setSanitizedHtml(editor, draft);
        } catch (e) { /* storage unavailable - start empty */ }
        updateCounts();

        if (window.WindowManager && typeof WindowManager.registerCleanup === 'function') {
            WindowManager.registerCleanup(winId, function () {
                document.removeEventListener('selectionchange', onSelectionChange);
                saveDraftNow(); // don't lose the last <700ms of typing
            });
        }
    };
})();
