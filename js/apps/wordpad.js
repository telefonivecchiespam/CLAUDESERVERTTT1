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
    // Word/WordPad "single" line spacing is the font's natural line height
    // (~1.22 x the size for Calibri), not 1.0 x. The editor shows
    // multiplier x LH_BASE; the RTF stores the plain multiplier (\sl240 = 1.0).
    const LH_BASE = 1.22;

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

    // colour from a CSS value; 'transparent' really means "none" (null), while
    // inherit/unparseable values leave the current colour alone
    function cssColor(val, current) {
        if (!val) return current;
        const v = String(val).trim().toLowerCase();
        if (v === 'transparent') return null;
        if (v === 'inherit' || v === 'initial' || v === 'unset' || v === 'currentcolor') return current;
        return parseColor(v) || current;
    }

    // CSS line-height on a block -> Word-style multiplier (1.0 = single), or 0
    function readLineMult(el) {
        const v = el.style && el.style.lineHeight;
        if (!v) return 0;
        let css = 0;
        if (/^[\d.]+$/.test(v)) css = parseFloat(v);
        else if (/%$/.test(v)) css = parseFloat(v) / 100;
        else return 0;
        if (!isFinite(css) || css <= 0) return 0;
        return Math.min(5, Math.max(0.5, Math.round(css / LH_BASE * 20) / 20));
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
        let props = { align: '', baseLi: 0, li: 0, list: null, listUsed: false, lineMult: 1 };
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
            if (props.lineMult && Math.abs(props.lineMult - 1) > 0.001) s += '\\sl' + Math.round(props.lineMult * 240) + '\\slmult1';
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
                if (st.color) c.color = cssColor(st.color, c.color);
                if (st.backgroundColor) c.bg = cssColor(st.backgroundColor, c.bg);
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
            const lm = readLineMult(el);
            if (lm) p.lineMult = lm;
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
            + '\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\viewkind4\\f0\\fs' + DEFAULT_HALF_PT + '\n'
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
        let cur = { align: '', li: 0, fi: 0, sl: 0, slmult: 0, list: null, runs: [] };
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
            cur = { align: cur.align, li: cur.li, fi: cur.fi, sl: cur.sl, slmult: cur.slmult, list: null, runs: [] };
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
                case 'pard': cur.align = ''; cur.li = 0; cur.fi = 0; cur.sl = 0; cur.slmult = 0; cur.list = null; break;
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
                case 'sl': cur.sl = param || 0; break;
                case 'slmult': cur.slmult = param === null ? 1 : param; break;
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
            const lineMult = (p.slmult === 1 && p.sl > 0) ? p.sl / 240 : 0;
            if (lineMult && Math.abs(lineMult - 1) > 0.01) block.style.lineHeight = String(Math.round(lineMult * LH_BASE * 100) / 100);
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
        'font-family', 'color', 'background-color', 'text-align', 'margin-left', 'text-indent', 'line-height']);

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
    // The app - a ribbon UI modelled on the Windows 10 WordPad
    // =====================================================================
    const LINE_SPACINGS = [1.0, 1.15, 1.5, 2.0, 2.5, 3.0];
    // Paint-style palette, the same set the real WordPad offers
    const PALETTE = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
        '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
    const RULER_CM_PX = 37.795;        // 1 cm at 96 dpi
    const SHEET_PX = 794;              // A4 width at 96 dpi
    const SHEET_MARGIN_PX = 120;       // 1.25 in, WordPad's default left/right margin
    const NARROW_BELOW_PX = 830;       // below this (after zoom) the sheet fills the window instead

    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }

    // tiny inline icons (stroke = currentColor, so they follow the button colour)
    function lineIcon(rows) {
        return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' + rows.map(function (r, i) {
            const y = 3 + i * 3.4;
            return '<line x1="' + r[0] + '" y1="' + y + '" x2="' + r[1] + '" y2="' + y + '" stroke="currentColor" stroke-width="1.4"/>';
        }).join('') + '</svg>';
    }
    const ICON = {
        left: lineIcon([[2, 14], [2, 10], [2, 14], [2, 8]]),
        center: lineIcon([[2, 14], [4, 12], [2, 14], [5, 11]]),
        right: lineIcon([[2, 14], [6, 14], [2, 14], [8, 14]]),
        justify: lineIcon([[2, 14], [2, 14], [2, 14], [2, 14]]),
        bullets: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="4" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="3" cy="12" r="1.4"/></g><g stroke="currentColor" stroke-width="1.4"><line x1="6.5" y1="4" x2="14" y2="4"/><line x1="6.5" y1="8" x2="14" y2="8"/><line x1="6.5" y1="12" x2="14" y2="12"/></g></svg>',
        numbers: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="currentColor" font-size="5" font-family="Arial,sans-serif"><text x="1" y="5.6">1</text><text x="1" y="9.6">2</text><text x="1" y="13.6">3</text></g><g stroke="currentColor" stroke-width="1.4"><line x1="6.5" y1="4" x2="14" y2="4"/><line x1="6.5" y1="8" x2="14" y2="8"/><line x1="6.5" y1="12" x2="14" y2="12"/></g></svg>',
        indent: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g stroke="currentColor" stroke-width="1.4"><line x1="2" y1="3" x2="14" y2="3"/><line x1="8" y1="6.5" x2="14" y2="6.5"/><line x1="8" y1="10" x2="14" y2="10"/><line x1="2" y1="13.5" x2="14" y2="13.5"/></g><polygon points="2,5.5 6,8.2 2,10.9" fill="currentColor"/></svg>',
        outdent: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g stroke="currentColor" stroke-width="1.4"><line x1="2" y1="3" x2="14" y2="3"/><line x1="8" y1="6.5" x2="14" y2="6.5"/><line x1="8" y1="10" x2="14" y2="10"/><line x1="2" y1="13.5" x2="14" y2="13.5"/></g><polygon points="6,5.5 2,8.2 6,10.9" fill="currentColor"/></svg>',
        spacing: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g stroke="currentColor" stroke-width="1.4"><line x1="8" y1="3" x2="15" y2="3"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="13" x2="15" y2="13"/></g><g fill="currentColor"><polygon points="3.5,2 6,5 1,5"/><polygon points="3.5,14 6,11 1,11"/></g><line x1="3.5" y1="4.5" x2="3.5" y2="11.5" stroke="currentColor" stroke-width="1.2"/></svg>',
        save: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 2h9l3 3v9H2z" fill="#3b6ea5" stroke="#244a73" stroke-width=".8"/><rect x="4.5" y="2.4" width="6" height="3.6" fill="#fff"/><rect x="4" y="9" width="8" height="4.6" fill="#dbe7f5"/></svg>'
    };

    function ensureStyles() {
        if (document.getElementById('wp-styles')) return;
        const FONT = '"Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif';
        const css = [
            '.wp-root{position:relative;display:flex;flex-direction:column;height:100%;background:#fff;font:12px ' + FONT + ';color:#1e1e1e;box-sizing:border-box;overflow:hidden;}',
            '.wp-root *{box-sizing:border-box;}',
            // tabs
            '.wp-tabs{display:flex;align-items:flex-end;background:#fff;border-bottom:1px solid #dadbdc;padding-left:2px;flex:0 0 auto;overflow-x:auto;overflow-y:hidden;}',
            '.wp-qat{display:flex;align-items:center;gap:1px;padding:0 8px 3px 4px;}',
            '.wp-tab{-webkit-appearance:none;appearance:none;background:transparent;border:1px solid transparent;border-bottom:none;padding:5px 14px;font:inherit;color:#1e1e1e;cursor:pointer;border-radius:0;margin-bottom:-1px;white-space:nowrap;}',
            '.wp-tab:hover{background:#e5f1fb;}',
            '.wp-tab.file{background:#1979ca;color:#fff;border-color:#1979ca;padding:5px 20px;margin-right:2px;}',
            '.wp-tab.file:hover,.wp-tab.file.open{background:#2b88d8;}',
            '.wp-tab.on{background:#f5f6f7;border-color:#dadbdc;border-bottom:1px solid #f5f6f7;}',
            // ribbon
            '.wp-ribbon{display:flex;align-items:stretch;background:#f5f6f7;border-bottom:1px solid #dadbdc;overflow-x:auto;overflow-y:hidden;flex:0 0 auto;min-height:90px;}',
            '.wp-ribbon[hidden]{display:none;}',
            '.wp-group{display:flex;flex-direction:column;padding:3px 7px 0;border-right:1px solid #e1e2e3;flex:0 0 auto;}',
            '.wp-gbody{display:flex;gap:4px;flex:1;align-items:flex-start;}',
            '.wp-glabel{text-align:center;color:#555;font-size:11px;padding:2px 0 3px;white-space:nowrap;}',
            '.wp-col{display:flex;flex-direction:column;gap:3px;}',
            '.wp-line{display:flex;align-items:center;gap:1px;}',
            '.wp-sep{width:1px;align-self:stretch;margin:2px 3px;background:#d4d5d6;}',
            // buttons
            '.wp-btn{-webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;background:transparent;color:#1e1e1e;border:1px solid transparent;padding:0 5px;min-width:26px;height:26px;font:inherit;cursor:pointer;border-radius:0;touch-action:manipulation;white-space:nowrap;}',
            '.wp-btn:hover{background:#e5f1fb;border-color:#cce4f7;}',
            '.wp-btn:active,.wp-btn.on{background:#cce4f7;border-color:#99c9ef;}',
            '.wp-btn.big{flex-direction:column;height:62px;min-width:50px;padding:3px 5px;gap:2px;}',
            '.wp-btn.big .wp-bico{font-size:26px;line-height:30px;}',
            '.wp-btn.row{justify-content:flex-start;width:100%;min-width:104px;}',
            '.wp-btn.small{height:24px;min-width:24px;}',
            '.wp-btn svg{display:block;}',
            '.wp-split{display:inline-flex;align-items:stretch;}',
            '.wp-split .wp-btn.arrow{min-width:13px;width:13px;padding:0;font-size:8px;}',
            '.wp-icol{display:flex;flex-direction:column;align-items:center;line-height:1;}',
            '.wp-aico{font-weight:600;font-size:14px;font-family:' + FONT + ';}',
            '.wp-cbar{display:block;height:3px;width:15px;margin-top:2px;}',
            '.wp-sel{height:24px;font:12px ' + FONT + ';background:#fff;color:#1e1e1e;border:1px solid #abadb3;border-radius:0;padding:0 2px;}',
            // document area
            '.wp-main{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;}',
            '.wp-pagearea{flex:1;min-height:0;overflow:auto;background:linear-gradient(#c3cfe1,#dce6f4);padding:0 8px 24px;}',
            '.wp-sheetwrap{margin:0 auto;width:' + SHEET_PX + 'px;}',
            '.wp-ruler{position:sticky;top:0;z-index:5;height:20px;background:#f7f7f7;border-bottom:1px solid #c9c9c9;overflow:hidden;margin-bottom:6px;font-size:10px;color:#333;user-select:none;-webkit-user-select:none;}',
            '.wp-ruler i{position:absolute;bottom:0;width:1px;background:#6a6a6a;}',
            '.wp-ruler b{position:absolute;top:2px;font-weight:normal;transform:translateX(-50%);}',
            '.wp-editor{min-height:1123px;background:#fff;color:#000;padding:26px ' + SHEET_MARGIN_PX + 'px 60px;outline:none;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;box-shadow:0 0 6px rgba(0,0,0,.35);',
            'font-family:Calibri,Carlito,Arial,sans-serif;font-size:' + DEFAULT_PT + 'pt;line-height:' + LH_BASE + ';tab-size:4;-moz-tab-size:4;}',
            '.wp-narrow .wp-sheetwrap{width:auto;}',
            '.wp-narrow .wp-editor{padding:14px 16px 40px;min-height:420px;}',
            '.wp-narrow .wp-ruler{display:none;}',
            '.wp-noruler .wp-ruler{display:none;}',
            '.wp-editor ul,.wp-editor ol{margin:0;padding-left:34px;}',
            '.wp-editor blockquote{margin:0 0 0 40px;border:none;padding:0;}',
            // status bar
            '.wp-status{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 8px;background:#f0f0f0;border-top:1px solid #d9d9d9;font-size:11px;color:#333;flex:0 0 auto;min-height:24px;}',
            '.wp-status[hidden]{display:none;}',
            '.wp-zoom{display:flex;align-items:center;gap:4px;}',
            '.wp-zoom input[type=range]{width:110px;}',
            '.wp-zoomlbl{min-width:38px;text-align:right;}',
            // popups
            '.wp-pop{position:absolute;z-index:30;background:#fff;border:1px solid #c6c6c6;box-shadow:2px 3px 8px rgba(0,0,0,.28);padding:2px;min-width:150px;max-width:94%;}',
            '.wp-mi{-webkit-appearance:none;appearance:none;display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:transparent;color:#1e1e1e;border:1px solid transparent;padding:5px 12px 5px 8px;font:inherit;cursor:pointer;border-radius:0;white-space:nowrap;}',
            '.wp-mi:hover{background:#e5f1fb;border-color:#cce4f7;}',
            '.wp-mi .wp-mk{width:16px;display:inline-flex;justify-content:center;}',
            '.wp-mhr{height:1px;background:#e1e2e3;margin:3px 2px;}',
            '.wp-pal{display:grid;grid-template-columns:repeat(10,18px);gap:3px;padding:6px;}',
            '.wp-sw{-webkit-appearance:none;appearance:none;width:18px;height:18px;padding:0;border:1px solid #8a8a8a;border-radius:0;cursor:pointer;}',
            '.wp-sw:hover{outline:2px solid #3c8ee0;outline-offset:0;}',
            '.wp-native{position:absolute;opacity:0;width:1px;height:1px;border:0;padding:0;pointer-events:none;}',
            // modal + find panel
            '.wp-ov{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;padding:8px;}',
            '.wp-modal{background:#fff;border:1px solid #1979ca;box-shadow:0 6px 22px rgba(0,0,0,.4);min-width:270px;max-width:100%;}',
            '.wp-mtitle{padding:7px 12px;font-weight:600;color:#1979ca;border-bottom:1px solid #e1e1e1;}',
            '.wp-mbody{padding:12px;display:flex;flex-direction:column;gap:8px;}',
            '.wp-mbody label{display:flex;flex-direction:column;gap:3px;}',
            '.wp-mfoot{display:flex;justify-content:flex-end;gap:6px;padding:0 12px 12px;}',
            '.wp-pbtn{-webkit-appearance:none;appearance:none;min-width:78px;height:26px;padding:0 10px;font:inherit;background:#e1e1e1;color:#000;border:1px solid #adadad;border-radius:0;cursor:pointer;}',
            '.wp-pbtn:hover{background:#e5f1fb;border-color:#0078d7;}',
            '.wp-pbtn.def{border-color:#0078d7;}',
            '.wp-in{height:26px;font:12px ' + FONT + ';background:#fff;color:#000;border:1px solid #7a7a7a;border-radius:0;padding:0 5px;width:100%;}',
            '.wp-find{position:absolute;right:20px;top:8px;z-index:20;width:310px;max-width:calc(100% - 30px);background:#f5f6f7;border:1px solid #adb0b3;box-shadow:2px 3px 10px rgba(0,0,0,.3);padding:8px 10px;display:flex;flex-direction:column;gap:6px;}',
            '.wp-find[hidden]{display:none;}',
            '.wp-find .hd{display:flex;justify-content:space-between;align-items:center;font-weight:600;}',
            '.wp-find .rw{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}',
            '.wp-find .chk{display:flex;align-items:center;gap:4px;}',
            '.wp-find .msg{min-height:14px;color:#a31515;font-size:11px;}'
        ].join('\n');
        const st = document.createElement('style');
        st.id = 'wp-styles';
        st.textContent = css;
        document.head.appendChild(st);
    }

    window.initWordpad = function (container, winId) {
        ensureStyles();

        const root = el('div', 'wp-root');
        container.appendChild(root);

        // ---------- structure ----------
        const tabsBar = el('div', 'wp-tabs');
        const qat = el('div', 'wp-qat');
        const fileTab = el('button', 'wp-tab file', 'File');
        const homeTab = el('button', 'wp-tab on', 'Home');
        const viewTab = el('button', 'wp-tab', 'Visualizza');
        [fileTab, homeTab, viewTab].forEach(function (b) { b.type = 'button'; });
        tabsBar.appendChild(qat); tabsBar.appendChild(fileTab); tabsBar.appendChild(homeTab); tabsBar.appendChild(viewTab);

        const homeRibbon = el('div', 'wp-ribbon');
        const viewRibbon = el('div', 'wp-ribbon');
        viewRibbon.hidden = true;

        const main = el('div', 'wp-main');
        const pageArea = el('div', 'wp-pagearea');
        const sheetWrap = el('div', 'wp-sheetwrap');
        const ruler = el('div', 'wp-ruler');
        const editor = el('div', 'wp-editor');
        editor.setAttribute('contenteditable', 'true');
        editor.spellcheck = true;
        editor.setAttribute('role', 'textbox');
        editor.setAttribute('aria-multiline', 'true');
        editor.setAttribute('aria-label', 'Documento');
        sheetWrap.appendChild(ruler); sheetWrap.appendChild(editor);
        pageArea.appendChild(sheetWrap);
        main.appendChild(pageArea);

        const status = el('div', 'wp-status');
        const countsEl = el('span', 'wp-counts');
        const noteEl = el('span', 'wp-note');
        const zoomBox = el('div', 'wp-zoom');
        status.appendChild(countsEl); status.appendChild(noteEl); status.appendChild(zoomBox);

        root.appendChild(tabsBar); root.appendChild(homeRibbon); root.appendChild(viewRibbon);
        root.appendChild(main); root.appendChild(status);

        // ruler marks: origin 0 sits at the left text margin, numbers count away from it
        (function buildRuler() {
            for (let half = -6; half <= 35; half++) {
                const cm = half / 2;
                const x = SHEET_MARGIN_PX + cm * RULER_CM_PX;
                if (x < 0 || x > SHEET_PX) continue;
                const tick = el('i');
                const whole = (half % 2 === 0);
                tick.style.left = x + 'px';
                tick.style.height = whole ? '7px' : '4px';
                ruler.appendChild(tick);
                if (whole && cm !== 0) { const n = el('b', '', String(Math.abs(cm))); n.style.left = x + 'px'; ruler.appendChild(n); }
            }
        })();

        // ---------- selection handling ----------
        // Anything outside the editor (selects, colour pickers, the find box,
        // even plain buttons on some phones) can steal focus/selection, so the
        // last selection inside the editor is remembered and restored before
        // every command.
        let savedRange = null;
        function saveSelection() {
            const sel = window.getSelection();
            if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
        }
        function restoreSelection() {
            editor.focus();
            const sel = window.getSelection();
            if (!sel) return;
            if (savedRange && editor.contains(savedRange.startContainer) && editor.contains(savedRange.endContainer)) {
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

        // ---------- popups (menus, palettes) ----------
        let openPop = null;
        function closePop() {
            if (openPop) { openPop.remove(); fileTab.classList.remove('open'); openPop = null; }
        }
        function showPop(anchor, build) {
            const same = openPop && openPop._anchor === anchor;
            closePop();
            if (same) return; // a second click on the same button closes it
            const pop = el('div', 'wp-pop');
            build(pop);
            root.appendChild(pop);
            const r = anchor.getBoundingClientRect();
            const rr = root.getBoundingClientRect();
            let left = r.left - rr.left;
            const maxLeft = rr.width - pop.offsetWidth - 4;
            if (left > maxLeft) left = Math.max(2, maxLeft);
            pop.style.left = left + 'px';
            pop.style.top = (r.bottom - rr.top + 1) + 'px';
            pop._anchor = anchor;
            openPop = pop;
        }
        function menuItem(pop, label, onClick, mark) {
            const b = el('button', 'wp-mi');
            b.type = 'button';
            const mk = el('span', 'wp-mk'); mk.textContent = mark || '';
            b.appendChild(mk);
            b.appendChild(document.createTextNode(label));
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function () { closePop(); onClick(); });
            pop.appendChild(b);
            return b;
        }
        function onDocPointerDown(e) {
            if (!openPop) return;
            if (openPop.contains(e.target) || (openPop._anchor && openPop._anchor.contains(e.target))) return;
            closePop();
        }
        document.addEventListener('pointerdown', onDocPointerDown, true);

        // ---------- modal dialog (inside the window) ----------
        function showModal(title, buildBody, buttons) {
            const ov = el('div', 'wp-ov');
            const box = el('div', 'wp-modal');
            const t = el('div', 'wp-mtitle'); t.textContent = title;
            const body = el('div', 'wp-mbody');
            const foot = el('div', 'wp-mfoot');
            box.appendChild(t); box.appendChild(body); box.appendChild(foot);
            ov.appendChild(box);
            root.appendChild(ov);
            function close() { ov.remove(); }
            buildBody(body);
            buttons.forEach(function (bt) {
                const b = el('button', 'wp-pbtn' + (bt.def ? ' def' : ''));
                b.type = 'button';
                b.textContent = bt.label;
                b.addEventListener('click', function () { if (bt.action) { if (bt.action() === false) return; } close(); });
                foot.appendChild(b);
            });
            ov.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') close();
                else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
                    const d = buttons.find(function (b) { return b.def; });
                    if (d) { e.preventDefault(); if (!d.action || d.action() !== false) close(); }
                }
            });
            const first = body.querySelector('input,select');
            if (first) first.focus();
            return close;
        }

        // ---------- ribbon building blocks ----------
        const toggles = []; // {cmd, btn}
        function mkBtn(parent, html, title, onClick, opts) {
            opts = opts || {};
            const b = el('button', 'wp-btn' + (opts.cls ? ' ' + opts.cls : ''), html);
            b.type = 'button';
            b.title = title;
            b.setAttribute('aria-label', title);
            // keep the editor's focus and selection when a ribbon button is pressed
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function (e) { onClick(e, b); });
            parent.appendChild(b);
            if (opts.cmd) toggles.push({ cmd: opts.cmd, btn: b });
            return b;
        }
        function group(parent, label) {
            const g = el('div', 'wp-group');
            const body = el('div', 'wp-gbody');
            const lab = el('div', 'wp-glabel'); lab.textContent = label;
            g.appendChild(body); g.appendChild(lab);
            parent.appendChild(g);
            return body;
        }
        function sep(parent) { parent.appendChild(el('span', 'wp-sep')); }

        // ---------- editing commands ----------
        function exec(cmd, val) {
            closePop();
            restoreSelection();
            try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
            document.execCommand(cmd, false, val === undefined ? null : val);
            saveSelection();
            afterEdit();
        }

        // execCommand only knows font sizes 1-7: ask for 7 and swap the result
        // for a span with the exact point size
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
            closePop();
            restoreSelection();
            pendingPt = pt;
            try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
            document.execCommand('fontSize', false, '7');
            try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
            convertSizeMarkers();
            saveSelection();
            afterEdit();
        }

        function insertPlainText(text) {
            if (!text) return;
            text.replace(/\r\n?/g, '\n').split('\n').forEach(function (line, idx) {
                if (idx > 0) document.execCommand('insertParagraph');
                if (line) document.execCommand('insertText', false, line);
            });
            afterEdit();
        }
        function doCopy(cut) {
            closePop();
            restoreSelection();
            const text = String(window.getSelection());
            if (!text) return;
            let done = false;
            try { done = document.execCommand(cut ? 'cut' : 'copy'); } catch (e) { done = false; }
            if (!done && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    if (cut) { restoreSelection(); document.execCommand('delete'); afterEdit(); }
                }, function () { noteEl.textContent = 'Il browser non consente di copiare da qui'; });
            } else if (done && cut) afterEdit();
        }
        function doPaste() {
            closePop();
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (t) { restoreSelection(); insertPlainText(t); },
                    function () { noteEl.textContent = 'Il browser non consente di incollare dal pulsante: usa Ctrl+V'; });
            } else noteEl.textContent = 'Il browser non consente di incollare dal pulsante: usa Ctrl+V';
        }

        // ---------- line spacing ----------
        function wrapRootInline() {
            const sel = window.getSelection();
            let keep = null;
            if (sel.rangeCount && editor.contains(sel.anchorNode)) {
                const r = sel.getRangeAt(0);
                keep = { sc: r.startContainer, so: r.startOffset, ec: r.endContainer, eo: r.endOffset };
            }
            let grp = [];
            function flush() {
                if (grp.some(function (n) { return n.nodeType !== 3 || n.nodeValue.trim() !== ''; })) {
                    const d = document.createElement('div');
                    editor.insertBefore(d, grp[0]);
                    grp.forEach(function (n) { d.appendChild(n); });
                }
                grp = [];
            }
            Array.prototype.slice.call(editor.childNodes).forEach(function (n) {
                if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) flush(); else grp.push(n);
            });
            flush();
            if (keep) {
                try {
                    const r = document.createRange();
                    r.setStart(keep.sc, keep.so);
                    r.setEnd(keep.ec, keep.eo);
                    sel.removeAllRanges();
                    sel.addRange(r);
                } catch (e) { /* offsets no longer valid: leave the caret where it is */ }
            }
        }
        function isTextBlock(b) {
            return Array.prototype.some.call(b.childNodes, function (c) {
                return (c.nodeType === 3 && c.nodeValue !== '') || (c.nodeType === 1 && !BLOCK_TAGS.has(c.tagName));
            });
        }
        function applyLineSpacing(mult) {
            closePop();
            restoreSelection();
            wrapRootInline();
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            const cands = Array.prototype.filter.call(editor.querySelectorAll('div,p,li,blockquote'), isTextBlock);
            let targets;
            if (range.collapsed) {
                let n = range.startContainer;
                while (n && n !== editor && !(n.nodeType === 1 && cands.indexOf(n) >= 0)) n = n.parentNode;
                targets = (n && n !== editor) ? [n] : [];
            } else {
                targets = cands.filter(function (b) { return range.intersectsNode(b); });
            }
            targets.forEach(function (b) {
                if (mult === 1) b.style.removeProperty('line-height');
                else b.style.lineHeight = String(Math.round(mult * LH_BASE * 100) / 100);
                if (!b.getAttribute('style')) b.removeAttribute('style');
            });
            saveSelection();
            afterEdit();
        }

        // ---------- document state: name, title ----------
        let docName = 'Documento';
        let docExt = 'rtf';
        let docNamed = false;
        function setTitle() {
            try {
                const w = window.WindowManager && WindowManager.windows && WindowManager.windows[winId];
                const t = w && w.querySelector('.window-title');
                if (t) t.textContent = (docNamed ? docName + '.' + docExt : docName) + ' - WordPad';
            } catch (e) { /* the title is cosmetic */ }
        }

        function hasText() { return editor.innerText.replace(/\s/g, '') !== ''; }
        function sendToBin() {
            if (hasText() && window.sendToRecycleBin) window.sendToRecycleBin(editor.innerText.trim(), 'WordPad');
        }
        function newDoc() {
            closePop();
            sendToBin();
            editor.textContent = '';
            savedRange = null;
            docName = 'Documento'; docExt = 'rtf'; docNamed = false;
            setTitle();
            afterEdit();
            editor.focus();
        }
        function downloadDoc(ext) {
            try {
                if (ext === 'txt') {
                    const text = editor.innerText.replace(/\u00a0/g, ' ').replace(/\r?\n/g, '\r\n');
                    downloadBlob(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' }), docName + '.txt');
                } else {
                    downloadBlob(new Blob([htmlToRtf(editor)], { type: 'application/rtf' }), docName + '.rtf');
                }
                noteEl.textContent = 'Salvato come ' + docName + '.' + ext;
            } catch (e) { showError('WordPad - Salvataggio', 'Non è stato possibile creare il file: ' + e.message); }
        }
        function saveAs() {
            closePop();
            let nameIn, typeSel;
            showModal('Salva con nome', function (body) {
                const l1 = el('label'); l1.appendChild(document.createTextNode('Nome del file:'));
                nameIn = el('input', 'wp-in'); nameIn.type = 'text'; nameIn.value = docName; l1.appendChild(nameIn);
                const l2 = el('label'); l2.appendChild(document.createTextNode('Salva come:'));
                typeSel = el('select', 'wp-sel'); typeSel.style.height = '26px';
                [['rtf', 'Documento RTF (*.rtf)'], ['txt', 'Documento di testo (*.txt)']].forEach(function (o) {
                    const op = el('option'); op.value = o[0]; op.textContent = o[1]; typeSel.appendChild(op);
                });
                typeSel.value = docExt;
                l2.appendChild(typeSel);
                body.appendChild(l1); body.appendChild(l2);
            }, [
                { label: 'Salva', def: true, action: function () {
                    docName = safeFileName(nameIn.value); docExt = typeSel.value; docNamed = true;
                    setTitle(); downloadDoc(docExt);
                } },
                { label: 'Annulla' }
            ]);
        }
        function saveDoc() {
            closePop();
            if (!docNamed) { saveAs(); return; }
            downloadDoc(docExt);
        }
        function printDoc() {
            closePop();
            try {
                const frame = document.createElement('iframe');
                frame.setAttribute('aria-hidden', 'true');
                frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
                document.body.appendChild(frame);
                const d = frame.contentDocument;
                d.open();
                d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + String(docName).replace(/[<>&]/g, '') + '</title>' +
                    '<style>@page{margin:2.5cm}body{margin:0;font-family:Calibri,Carlito,Arial,sans-serif;font-size:' + DEFAULT_PT + 'pt;line-height:' + LH_BASE + ';white-space:pre-wrap}' +
                    'ul,ol{margin:0;padding-left:34px}blockquote{margin:0 0 0 40px}</style></head><body></body></html>');
                d.close();
                const parsed = new DOMParser().parseFromString(editor.innerHTML, 'text/html');
                Array.prototype.forEach.call(parsed.body.childNodes, function (c) { cloneClean(c, d.body); });
                setTimeout(function () {
                    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
                    catch (e) { showError('WordPad - Stampa', 'La stampa non è disponibile in questo browser.'); }
                    setTimeout(function () { frame.remove(); }, 3000);
                }, 150);
            } catch (e) { showError('WordPad - Stampa', 'Non è stato possibile preparare la stampa.'); }
        }

        const fileInput = el('input');
        fileInput.type = 'file';
        fileInput.accept = '.rtf,.txt,text/plain,application/rtf,text/rtf';
        fileInput.style.display = 'none';
        root.appendChild(fileInput);

        function openFile(file) {
            if (!file) return;
            if (file.size > MAX_OPEN_BYTES) { showError('WordPad - Apri', 'Il file è troppo grande (massimo 5 MB).'); return; }
            const reader = new FileReader();
            reader.onerror = function () { showError('WordPad - Apri', 'Non è stato possibile leggere il file.'); };
            reader.onload = function () {
                let text;
                try { text = decodeText(reader.result); } catch (e) { showError('WordPad - Apri', 'Codifica del file non riconosciuta.'); return; }
                let frag;
                const isRtf = /\.rtf$/i.test(file.name) || /^\s*\{\\rtf/.test(text);
                try {
                    if (isRtf) {
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
                docName = safeFileName(file.name); docExt = isRtf ? 'rtf' : 'txt'; docNamed = true;
                setTitle();
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

        // ---------- File menu ----------
        fileTab.addEventListener('mousedown', function (e) { e.preventDefault(); });
        fileTab.addEventListener('click', function () {
            showPop(fileTab, function (pop) {
                menuItem(pop, 'Nuovo', newDoc);
                menuItem(pop, 'Apri…', function () { fileInput.click(); });
                menuItem(pop, 'Salva', saveDoc);
                menuItem(pop, 'Salva con nome…', saveAs);
                pop.appendChild(el('div', 'wp-mhr'));
                menuItem(pop, 'Stampa', printDoc);
                pop.appendChild(el('div', 'wp-mhr'));
                menuItem(pop, 'Esci', function () {
                    if (window.WindowManager && WindowManager.closeWindow) WindowManager.closeWindow(winId);
                });
            });
            fileTab.classList.toggle('open', !!openPop);
        });
        homeTab.addEventListener('click', function () { closePop(); homeTab.classList.add('on'); viewTab.classList.remove('on'); homeRibbon.hidden = false; viewRibbon.hidden = true; });
        viewTab.addEventListener('click', function () { closePop(); viewTab.classList.add('on'); homeTab.classList.remove('on'); viewRibbon.hidden = false; homeRibbon.hidden = true; });

        // quick access: save / undo / redo
        mkBtn(qat, ICON.save, 'Salva (Ctrl+S)', saveDoc, { cls: 'small' });
        mkBtn(qat, '↶', 'Annulla (Ctrl+Z)', function () { exec('undo'); }, { cls: 'small' });
        mkBtn(qat, '↷', 'Ripeti (Ctrl+Y)', function () { exec('redo'); }, { cls: 'small' });

        // ---------- HOME: Appunti ----------
        const gClip = group(homeRibbon, 'Appunti');
        mkBtn(gClip, '<span class="wp-bico">📋</span><span>Incolla</span>', 'Incolla (Ctrl+V)', doPaste, { cls: 'big' });
        const clipCol = el('div', 'wp-col'); gClip.appendChild(clipCol);
        mkBtn(clipCol, '<span>✂</span><span>Taglia</span>', 'Taglia (Ctrl+X)', function () { doCopy(true); }, { cls: 'row' });
        mkBtn(clipCol, '<span>⧉</span><span>Copia</span>', 'Copia (Ctrl+C)', function () { doCopy(false); }, { cls: 'row' });

        // ---------- HOME: Carattere ----------
        const gFont = group(homeRibbon, 'Carattere');
        const fontCol = el('div', 'wp-col'); gFont.appendChild(fontCol);
        const fontLine1 = el('div', 'wp-line'); const fontLine2 = el('div', 'wp-line');
        fontCol.appendChild(fontLine1); fontCol.appendChild(fontLine2);

        const fontSel = el('select', 'wp-sel');
        fontSel.title = 'Tipo di carattere'; fontSel.setAttribute('aria-label', 'Tipo di carattere'); fontSel.style.width = '118px';
        FONT_LIST.forEach(function (f) { const o = el('option'); o.value = f; o.textContent = f; fontSel.appendChild(o); });
        fontSel.addEventListener('change', function () { exec('fontName', fontSel.value); });
        fontLine1.appendChild(fontSel);

        const sizeSel = el('select', 'wp-sel');
        sizeSel.title = 'Dimensione carattere'; sizeSel.setAttribute('aria-label', 'Dimensione carattere'); sizeSel.style.width = '48px'; sizeSel.style.marginLeft = '3px';
        SIZE_LIST.forEach(function (s) { const o = el('option'); o.value = String(s); o.textContent = String(s); sizeSel.appendChild(o); });
        sizeSel.value = String(DEFAULT_PT);
        sizeSel.addEventListener('change', function () { applySize(parseInt(sizeSel.value, 10)); });
        fontLine1.appendChild(sizeSel);

        function stepSize(dir) {
            const cur = parseInt(sizeSel.value, 10);
            const idx = SIZE_LIST.indexOf(cur);
            let next = cur;
            if (idx >= 0) next = SIZE_LIST[Math.min(SIZE_LIST.length - 1, Math.max(0, idx + dir))];
            else if (dir > 0) next = SIZE_LIST.find(function (s) { return s > cur; }) || cur;
            else next = SIZE_LIST.slice().reverse().find(function (s) { return s < cur; }) || cur;
            sizeSel.value = String(next);
            applySize(next);
        }
        mkBtn(fontLine1, '<span style="font-size:14px">A</span><span style="font-size:8px">▲</span>', 'Ingrandisci carattere', function () { stepSize(1); }, { cls: 'small' });
        mkBtn(fontLine1, '<span style="font-size:10px">A</span><span style="font-size:8px">▼</span>', 'Riduci carattere', function () { stepSize(-1); }, { cls: 'small' });

        mkBtn(fontLine2, '<b>G</b>', 'Grassetto (Ctrl+B)', function () { exec('bold'); }, { cls: 'small', cmd: 'bold' });
        mkBtn(fontLine2, '<i>C</i>', 'Corsivo (Ctrl+I)', function () { exec('italic'); }, { cls: 'small', cmd: 'italic' });
        mkBtn(fontLine2, '<u>S</u>', 'Sottolineato (Ctrl+U)', function () { exec('underline'); }, { cls: 'small', cmd: 'underline' });
        mkBtn(fontLine2, '<s>abc</s>', 'Barrato', function () { exec('strikeThrough'); }, { cls: 'small', cmd: 'strikeThrough' });
        mkBtn(fontLine2, 'x<sub>2</sub>', 'Pedice', function () { exec('subscript'); }, { cls: 'small', cmd: 'subscript' });
        mkBtn(fontLine2, 'x<sup>2</sup>', 'Apice', function () { exec('superscript'); }, { cls: 'small', cmd: 'superscript' });
        fontLine2.appendChild(el('span', 'wp-sep'));

        // split colour buttons: the main part applies the CURRENT colour straight away
        // (like the real WordPad), the arrow opens the palette to change it
        function mkColorSplit(parent, o) {
            const wrap = el('span', 'wp-split');
            const native = el('input', 'wp-native');
            native.type = 'color';
            native.value = o.initial;
            native.tabIndex = -1;
            native.setAttribute('aria-label', o.title);
            let current = o.initial;
            const bar = el('span', 'wp-cbar');
            bar.style.background = current;
            const mainBtn = mkBtn(wrap, '', o.title, function () { o.apply(current); }, { cls: 'small' });
            const ico = el('span', 'wp-icol');
            ico.innerHTML = o.glyph;
            ico.appendChild(bar);
            mainBtn.appendChild(ico);
            function setCurrent(c) { current = c; bar.style.background = c; }
            const arrow = mkBtn(wrap, '▾', o.title + ' - scegli colore', function (e, b) {
                showPop(b, function (pop) {
                    const pal = el('div', 'wp-pal');
                    PALETTE.forEach(function (c) {
                        const sw = el('button', 'wp-sw');
                        sw.type = 'button'; sw.title = c; sw.setAttribute('aria-label', c);
                        sw.style.background = c;
                        sw.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
                        sw.addEventListener('click', function () { closePop(); setCurrent(c); o.apply(c); });
                        pal.appendChild(sw);
                    });
                    pop.appendChild(pal);
                    pop.appendChild(el('div', 'wp-mhr'));
                    if (o.noneLabel) menuItem(pop, o.noneLabel, function () { o.apply(o.noneValue); });
                    menuItem(pop, 'Altri colori…', function () { native.click(); });
                });
            }, { cls: 'arrow small' });
            native.addEventListener('change', function () { setCurrent(native.value); o.apply(native.value); });
            wrap.appendChild(native);
            parent.appendChild(wrap);
            return arrow;
        }
        mkColorSplit(fontLine2, {
            title: 'Colore del carattere', glyph: '<span class="wp-aico">A</span>', initial: '#000000',
            apply: function (c) { exec('foreColor', c); },
            noneLabel: 'Automatico', noneValue: '#000000'
        });
        mkColorSplit(fontLine2, {
            title: 'Colore di evidenziazione del testo', glyph: '<span class="wp-aico" style="font-size:13px">✎</span>', initial: '#fff200',
            apply: function (c) {
                closePop();
                restoreSelection();
                try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
                if (!document.execCommand('hiliteColor', false, c)) document.execCommand('backColor', false, c);
                saveSelection();
                afterEdit();
            },
            noneLabel: 'Nessun colore', noneValue: 'transparent'
        });

        // ---------- HOME: Paragrafo ----------
        const gPara = group(homeRibbon, 'Paragrafo');
        const paraCol = el('div', 'wp-col'); gPara.appendChild(paraCol);
        const paraLine1 = el('div', 'wp-line'); const paraLine2 = el('div', 'wp-line');
        paraCol.appendChild(paraLine1); paraCol.appendChild(paraLine2);
        mkBtn(paraLine1, ICON.outdent, 'Riduci rientro', function () { exec('outdent'); }, { cls: 'small' });
        mkBtn(paraLine1, ICON.indent, 'Aumenta rientro', function () { exec('indent'); }, { cls: 'small' });

        const bulletSplit = el('span', 'wp-split'); paraLine1.appendChild(bulletSplit);
        mkBtn(bulletSplit, ICON.bullets, 'Elenco puntato', function () { exec('insertUnorderedList'); }, { cls: 'small', cmd: 'insertUnorderedList' });
        mkBtn(bulletSplit, '▾', 'Tipo di elenco', function (e, b) {
            showPop(b, function (pop) {
                menuItem(pop, 'Elenco puntato', function () { exec('insertUnorderedList'); }, '•');
                menuItem(pop, 'Elenco numerato 1. 2. 3.', function () { exec('insertOrderedList'); }, '1.');
            });
        }, { cls: 'arrow small' });

        mkBtn(paraLine1, ICON.spacing + '<span style="font-size:8px">▾</span>', 'Spaziatura righe', function (e, b) {
            showPop(b, function (pop) {
                LINE_SPACINGS.forEach(function (m) {
                    // "1,0" "1,15" "1,5" "2,0"... as the real WordPad shows them (String(1.0) would give "1")
                    menuItem(pop, (Math.round(m * 100) % 10 === 0 ? m.toFixed(1) : m.toFixed(2)).replace('.', ','), function () { applyLineSpacing(m); });
                });
            });
        }, { cls: 'small' });

        mkBtn(paraLine2, ICON.left, 'Allinea a sinistra (Ctrl+L)', function () { exec('justifyLeft'); }, { cls: 'small', cmd: 'justifyLeft' });
        mkBtn(paraLine2, ICON.center, 'Centra (Ctrl+E)', function () { exec('justifyCenter'); }, { cls: 'small', cmd: 'justifyCenter' });
        mkBtn(paraLine2, ICON.right, 'Allinea a destra (Ctrl+R)', function () { exec('justifyRight'); }, { cls: 'small', cmd: 'justifyRight' });
        mkBtn(paraLine2, ICON.justify, 'Giustifica (Ctrl+J)', function () { exec('justifyFull'); }, { cls: 'small', cmd: 'justifyFull' });

        // ---------- HOME: Inserisci ----------
        const gIns = group(homeRibbon, 'Inserisci');
        mkBtn(gIns, '<span class="wp-bico">🕒</span><span>Data e ora</span>', 'Inserisci data e ora', function (e, b) {
            showPop(b, function (pop) {
                const d = new Date();
                const pad = function (n) { return String(n).padStart(2, '0'); };
                [
                    d.toLocaleDateString('it-IT'),
                    d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                    d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }),
                    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
                    d.toLocaleTimeString('it-IT'),
                    d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT')
                ].forEach(function (txt) { menuItem(pop, txt, function () { exec('insertText', txt); }); });
            });
        }, { cls: 'big' });

        // ---------- HOME: Modifica ----------
        const gEdit = group(homeRibbon, 'Modifica');
        const editCol = el('div', 'wp-col'); gEdit.appendChild(editCol);
        mkBtn(editCol, '<span>🔍</span><span>Trova</span>', 'Trova (Ctrl+F)', function () { openFind(false); }, { cls: 'row' });
        mkBtn(editCol, '<span>⇄</span><span>Sostituisci</span>', 'Sostituisci (Ctrl+H)', function () { openFind(true); }, { cls: 'row' });
        mkBtn(editCol, '<span>▦</span><span>Seleziona tutto</span>', 'Seleziona tutto (Ctrl+A)', function () { exec('selectAll'); }, { cls: 'row' });

        // ---------- VISUALIZZA ----------
        let zoom = 100;
        const gZoom = group(viewRibbon, 'Zoom');
        mkBtn(gZoom, '<span class="wp-bico">＋</span><span>Zoom avanti</span>', 'Zoom avanti', function () { setZoom(zoom + 10); }, { cls: 'big' });
        mkBtn(gZoom, '<span class="wp-bico">－</span><span>Zoom indietro</span>', 'Zoom indietro', function () { setZoom(zoom - 10); }, { cls: 'big' });
        mkBtn(gZoom, '<span class="wp-bico">100%</span><span>100%</span>', 'Zoom al 100%', function () { setZoom(100); }, { cls: 'big' });
        const gShow = group(viewRibbon, 'Mostra o nascondi');
        const showCol = el('div', 'wp-col'); gShow.appendChild(showCol);
        function mkCheck(label, checked, onChange) {
            const l = el('label', 'wp-line');
            l.style.cursor = 'pointer'; l.style.padding = '3px 4px'; l.style.gap = '6px';
            const c = el('input'); c.type = 'checkbox'; c.checked = checked;
            c.addEventListener('change', function () { onChange(c.checked); });
            l.appendChild(c); l.appendChild(document.createTextNode(label));
            showCol.appendChild(l);
        }
        mkCheck('Righello', true, function (on) { root.classList.toggle('wp-noruler', !on); });
        mkCheck('Barra di stato', true, function (on) { status.hidden = !on; });

        // ---------- status bar: zoom ----------
        const zMinus = mkBtn(zoomBox, '－', 'Zoom indietro', function () { setZoom(zoom - 10); }, { cls: 'small' });
        const zRange = el('input'); zRange.type = 'range'; zRange.min = '20'; zRange.max = '300'; zRange.step = '10'; zRange.value = '100';
        zRange.setAttribute('aria-label', 'Zoom');
        const zLbl = el('span', 'wp-zoomlbl', '100%');
        const zPlus = mkBtn(zoomBox, '＋', 'Zoom avanti', function () { setZoom(zoom + 10); }, { cls: 'small' });
        zoomBox.insertBefore(zRange, zPlus);
        zoomBox.insertBefore(zLbl, zMinus);
        zRange.addEventListener('input', function () { setZoom(parseInt(zRange.value, 10)); });

        function updateLayout() {
            const eff = (pageArea.clientWidth - 16) / (zoom / 100);
            // jsdom / hidden windows report 0: keep the wide layout then
            root.classList.toggle('wp-narrow', eff > 0 && eff < NARROW_BELOW_PX);
        }
        function setZoom(z) {
            zoom = Math.max(20, Math.min(300, Math.round(z / 10) * 10));
            sheetWrap.style.zoom = String(zoom / 100);
            zLbl.textContent = zoom + '%';
            zRange.value = String(zoom);
            updateLayout();
        }
        pageArea.addEventListener('wheel', function (e) {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom(zoom + (e.deltaY < 0 ? 10 : -10));
        }, { passive: false });

        let resizeObs = null;
        function onWinResize() { updateLayout(); }
        if (typeof ResizeObserver !== 'undefined') { resizeObs = new ResizeObserver(onWinResize); resizeObs.observe(pageArea); }
        else window.addEventListener('resize', onWinResize);

        // ---------- find / replace ----------
        const findPanel = el('div', 'wp-find');
        findPanel.hidden = true;
        findPanel.innerHTML =
            '<div class="hd"><span class="ft">Trova</span><button type="button" class="wp-btn small fx" title="Chiudi" aria-label="Chiudi">✕</button></div>' +
            '<input class="wp-in fq" type="text" placeholder="Trova" aria-label="Testo da trovare">' +
            '<input class="wp-in fr" type="text" placeholder="Sostituisci con" aria-label="Sostituisci con">' +
            '<div class="rw"><label class="chk"><input type="checkbox" class="fw"> Solo parole intere</label><label class="chk"><input type="checkbox" class="fc"> Maiuscole/minuscole</label></div>' +
            '<div class="rw"><button type="button" class="wp-pbtn def fn">Trova successivo</button><button type="button" class="wp-pbtn fp">Sostituisci</button><button type="button" class="wp-pbtn fa">Sostituisci tutto</button></div>' +
            '<div class="msg" role="status"></div>';
        main.appendChild(findPanel);
        const fQ = findPanel.querySelector('.fq'), fR = findPanel.querySelector('.fr');
        const fWhole = findPanel.querySelector('.fw'), fCase = findPanel.querySelector('.fc');
        const fMsg = findPanel.querySelector('.msg'), fTitle = findPanel.querySelector('.ft');
        const fBtnNext = findPanel.querySelector('.fn'), fBtnRep = findPanel.querySelector('.fp'), fBtnAll = findPanel.querySelector('.fa');

        function openFind(withReplace) {
            closePop();
            saveSelection();
            findPanel.hidden = false;
            fR.style.display = withReplace ? '' : 'none';
            fBtnRep.style.display = withReplace ? '' : 'none';
            fBtnAll.style.display = withReplace ? '' : 'none';
            fTitle.textContent = withReplace ? 'Sostituisci' : 'Trova';
            const picked = savedRange && !savedRange.collapsed ? savedRange.toString() : '';
            if (picked && picked.indexOf('\n') < 0 && picked.length < 120) fQ.value = picked;
            fMsg.textContent = '';
            fQ.focus();
            fQ.select();
        }
        function closeFind() { findPanel.hidden = true; fMsg.textContent = ''; restoreSelection(); }

        function blockOf(n) {
            let p = n.parentNode;
            while (p && p !== editor) { if (BLOCK_TAGS.has(p.tagName)) return p; p = p.parentNode; }
            return editor;
        }
        // flat text of the document with a '\n' between paragraphs/<br>, plus where each text node starts,
        // so a word split across formatting runs ("te" + bold "st") is still found
        function collectText() {
            const nodes = [], starts = [];
            let text = '', lastBlock = null;
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
            let n;
            while ((n = walker.nextNode())) {
                if (n.nodeType === 1) { if (n.tagName === 'BR') text += '\n'; continue; }
                const blk = blockOf(n);
                if (lastBlock !== null && blk !== lastBlock) text += '\n';
                lastBlock = blk;
                nodes.push(n); starts.push(text.length);
                text += n.nodeValue;
            }
            return { nodes: nodes, starts: starts, text: text };
        }
        function isWordChar(ch) { return !!ch && /[0-9A-Za-z_\u00C0-\u024F]/.test(ch); }
        function searchFrom(data, query, from, wholeWord, matchCase) {
            const hay = matchCase ? data.text : data.text.toLowerCase();
            const q = matchCase ? query : query.toLowerCase();
            let idx = hay.indexOf(q, from);
            while (idx >= 0) {
                if (!wholeWord || (!isWordChar(hay.charAt(idx - 1)) && !isWordChar(hay.charAt(idx + q.length)))) return idx;
                idx = hay.indexOf(q, idx + 1);
            }
            return -1;
        }
        function pointAt(data, idx, isEnd) {
            for (let i = 0; i < data.nodes.length; i++) {
                const s = data.starts[i], l = data.nodes[i].nodeValue.length;
                if (isEnd ? (idx > s && idx <= s + l) : (idx >= s && idx < s + l)) return [data.nodes[i], idx - s];
            }
            return null;
        }
        function selectMatch(data, from, to) {
            const a = pointAt(data, from, false), b = pointAt(data, to, true);
            if (!a || !b) return false;
            const r = document.createRange();
            r.setStart(a[0], a[1]);
            r.setEnd(b[0], b[1]);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
            try { a[0].parentElement.scrollIntoView({ block: 'nearest' }); } catch (e) { /* cosmetic */ }
            return true;
        }
        function cursorIndex(data) {
            const r = savedRange;
            if (!r || !editor.contains(r.endContainer)) return 0;
            const ec = r.endContainer;
            if (ec.nodeType === 3) {
                const i = data.nodes.indexOf(ec);
                if (i >= 0) return data.starts[i] + r.endOffset;
            }
            const probe = document.createRange();
            probe.setStart(ec, r.endOffset);
            probe.collapse(true);
            for (let i = 0; i < data.nodes.length; i++) {
                if (probe.comparePoint(data.nodes[i], 0) >= 0) return data.starts[i];
            }
            return data.text.length;
        }
        function findNext() {
            const q = fQ.value;
            fMsg.textContent = '';
            if (!q) { fMsg.textContent = 'Scrivi il testo da cercare.'; return false; }
            const data = collectText();
            const whole = fWhole.checked, mc = fCase.checked;
            let idx = searchFrom(data, q, cursorIndex(data), whole, mc);
            let wrapped = false;
            if (idx < 0) { idx = searchFrom(data, q, 0, whole, mc); wrapped = idx >= 0; }
            if (idx < 0) { fMsg.textContent = 'Testo non trovato.'; return false; }
            selectMatch(data, idx, idx + q.length);
            if (wrapped) fMsg.textContent = 'Ricerca ripartita dall\'inizio del documento.';
            return true;
        }
        function selectionIsMatch() {
            const q = fQ.value;
            if (!q || !savedRange || savedRange.collapsed || !editor.contains(savedRange.startContainer)) return false;
            const t = savedRange.toString();
            const same = fCase.checked ? t === q : t.toLowerCase() === q.toLowerCase();
            return same;
        }
        function replaceOne() {
            fMsg.textContent = '';
            if (!fQ.value) { fMsg.textContent = 'Scrivi il testo da cercare.'; return; }
            if (!selectionIsMatch()) { findNext(); return; }
            restoreSelection();
            const rep = fR.value;
            if (rep === '') document.execCommand('delete'); else document.execCommand('insertText', false, rep);
            saveSelection();
            afterEdit();
            findNext();
        }
        function replaceAll() {
            fMsg.textContent = '';
            const q = fQ.value;
            if (!q) { fMsg.textContent = 'Scrivi il testo da cercare.'; return; }
            const rep = fR.value;
            const whole = fWhole.checked, mc = fCase.checked;
            editor.focus();
            let count = 0, from = 0;
            for (let guard = 0; guard < 10000; guard++) {
                const data = collectText();
                const idx = searchFrom(data, q, from, whole, mc);
                if (idx < 0) break;
                if (!selectMatch(data, idx, idx + q.length)) break;
                if (rep === '') document.execCommand('delete'); else document.execCommand('insertText', false, rep);
                count++;
                from = idx + rep.length;
            }
            saveSelection();
            afterEdit();
            fMsg.textContent = count ? (count === 1 ? '1 sostituzione.' : count + ' sostituzioni.') : 'Testo non trovato.';
            fMsg.style.color = count ? '#1a6b1a' : '#a31515';
        }
        fBtnNext.addEventListener('click', function () { fMsg.style.color = ''; findNext(); });
        fBtnRep.addEventListener('click', function () { fMsg.style.color = ''; replaceOne(); });
        fBtnAll.addEventListener('click', replaceAll);
        findPanel.querySelector('.fx').addEventListener('click', closeFind);
        findPanel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeFind(); return; }
            if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') {
                e.preventDefault();
                fMsg.style.color = '';
                if (e.target === fR && fR.style.display !== 'none') replaceOne(); else findNext();
            }
        });

        // ---------- state reflection ----------
        function updateState() {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return;
            toggles.forEach(function (t) {
                let on = false;
                try { on = document.queryCommandState(t.cmd); } catch (e) { /* ignore */ }
                t.btn.classList.toggle('on', !!on);
            });
            try {
                const name = String(document.queryCommandValue('fontName') || '').replace(/^["']|["']$/g, '').toLowerCase();
                const opt = Array.prototype.find.call(fontSel.options, function (o) { return o.value.toLowerCase() === name; });
                if (opt) fontSel.value = opt.value;
            } catch (e) { /* ignore */ }
            try {
                let node = sel.anchorNode;
                if (node && node.nodeType === 3) node = node.parentElement;
                if (node) {
                    const pt = Math.round(parseFloat(getComputedStyle(node).fontSize) * 0.75);
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
            const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
            if (mod && !e.shiftKey) {
                const k = e.key.toLowerCase();
                if (k === 's') { e.preventDefault(); saveDoc(); return; }
                if (k === 'o') { e.preventDefault(); fileInput.click(); return; }
                if (k === 'p') { e.preventDefault(); printDoc(); return; }
                if (k === 'f') { e.preventDefault(); openFind(false); return; }
                if (k === 'h') { e.preventDefault(); openFind(true); return; }
                if (k === 'l') { e.preventDefault(); exec('justifyLeft'); return; }
                if (k === 'e') { e.preventDefault(); exec('justifyCenter'); return; }
                if (k === 'r') { e.preventDefault(); exec('justifyRight'); return; }
                if (k === 'j') { e.preventDefault(); exec('justifyFull'); return; }
            }
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
            insertPlainText(cd ? cd.getData('text/plain') : '');
        });
        // dropping a file on the page would otherwise navigate away from the desktop
        editor.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
        editor.addEventListener('drop', function (e) {
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                e.preventDefault();
                openFile(e.dataTransfer.files[0]);
            }
        });
        // clicking the blue-grey area around the sheet puts the caret in the document
        pageArea.addEventListener('mousedown', function (e) {
            if (e.target !== pageArea && e.target !== sheetWrap) return;
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
        setTitle();
        updateLayout();

        if (window.WindowManager && typeof WindowManager.registerCleanup === 'function') {
            WindowManager.registerCleanup(winId, function () {
                document.removeEventListener('selectionchange', onSelectionChange);
                document.removeEventListener('pointerdown', onDocPointerDown, true);
                if (resizeObs) resizeObs.disconnect(); else window.removeEventListener('resize', onWinResize);
                saveDraftNow(); // don't lose the last <700ms of typing
            });
        }
    };
})();
