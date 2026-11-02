/* Tests for the RTL horizontal-motion mirroring. Run with `npm test`. */

global.window = {
	CodeMirrorAdapter: { Vim: { getRegisterController: () => ({}), handleKey() {} } },
};
global.document = { addEventListener() {}, removeEventListener() {} };

const VimLayoutSwitchPlugin = require("./.build/plugin.cjs").default;

const plugin = new VimLayoutSwitchPlugin();
plugin.settings = Object.assign({}, plugin.settings, { rtlHorizontalSwap: "auto" });

const ARABIC = "مرحبا بالعالم، هذه ملاحظة عربية";
const ENGLISH = "hello world, this is a note";

function makeCm(text, ch, options = {}) {
	const lines = options.lines || {};
	const line = options.line || 0;
	return {
		getCursor: () => ({ line, ch }),
		getLine: (index) => {
			if (Object.prototype.hasOwnProperty.call(lines, index)) return lines[index];
			return index === line ? text : "";
		},
		state: {
			vim: {
				inputState: { motionRepeat: options.repeat || [] },
				expectLiteralNext: Boolean(options.expectLiteral),
			},
		},
	};
}

const results = [];

function check(label, actual, expected) {
	results.push({ ok: JSON.stringify(actual) === JSON.stringify(expected), label, actual, expected });
}

/* ---------------------------------------------------------- direction --- */

check("arabic mid-line is RTL", plugin.isRtlAt(makeCm(ARABIC, 8)), true);
check("arabic at line start is RTL", plugin.isRtlAt(makeCm(ARABIC, 0)), true);
check("arabic at line end is RTL", plugin.isRtlAt(makeCm(ARABIC, ARABIC.length)), true);
check("english mid-line is LTR", plugin.isRtlAt(makeCm(ENGLISH, 6)), false);
check(
	"english note quoting arabic stays LTR at the cursor",
	plugin.isRtlAt(makeCm("The word سلام means peace and it appears here", 5)),
	false,
);
check(
	"arabic line containing a latin word stays RTL at the cursor",
	plugin.isRtlAt(makeCm("هذه ملاحظة فيها Obsidian word وهنا نص عربي", 4)),
	true,
);
check(
	"empty line borrows the neighbour direction",
	plugin.isRtlAt(makeCm("", 0, { lines: { 1: "سطر عربي" } })),
	true,
);
check(
	"empty line above an english paragraph is LTR",
	plugin.isRtlAt(makeCm("", 0, { lines: { 1: "english paragraph" } })),
	false,
);
check("empty document defaults to LTR", plugin.isRtlAt(makeCm("", 0)), false);

/* -------------------------------------------------------------- swaps --- */

const rtlCm = makeCm(ARABIC, 8);
const ltrCm = makeCm(ENGLISH, 6);

check("rtl h -> l", plugin.rtlSwapKey(rtlCm, "h"), "l");
check("rtl l -> h", plugin.rtlSwapKey(rtlCm, "l"), "h");
check("rtl ArrowLeft -> <Right>", plugin.rtlSwapKey(rtlCm, "ArrowLeft"), "<Right>");
check("rtl ArrowRight -> <Left>", plugin.rtlSwapKey(rtlCm, "ArrowRight"), "<Left>");

check("rtl w untouched (logical flow)", plugin.rtlSwapKey(rtlCm, "w"), null);
check("rtl b untouched (logical flow)", plugin.rtlSwapKey(rtlCm, "b"), null);
check("rtl e untouched (logical flow)", plugin.rtlSwapKey(rtlCm, "e"), null);
check("rtl 0 untouched (logical start)", plugin.rtlSwapKey(rtlCm, "0"), null);
check("rtl $ untouched (logical end)", plugin.rtlSwapKey(rtlCm, "$"), null);

check("ltr h untouched", plugin.rtlSwapKey(ltrCm, "h"), null);
check("ltr l untouched", plugin.rtlSwapKey(ltrCm, "l"), null);
check("ltr $ untouched", plugin.rtlSwapKey(ltrCm, "$"), null);
check("ltr w untouched", plugin.rtlSwapKey(ltrCm, "w"), null);
check("ltr b untouched", plugin.rtlSwapKey(ltrCm, "b"), null);
check("ltr e untouched", plugin.rtlSwapKey(ltrCm, "e"), null);
check("unrelated key untouched", plugin.rtlSwapKey(rtlCm, "j"), null);

plugin.saved = [{ name: "kb", index: 1, keymap: "Arabic" }];
check("empty document with saved RTL layout detects RTL", plugin.isCurrentLanguageRtl(makeCm("", 0)), true);
check("saved RTL layout swaps on empty document", plugin.rtlSwapKey(makeCm("", 0), "h"), "l");
plugin.saved = null;
check("empty document without saved layout stays LTR", plugin.isCurrentLanguageRtl(makeCm("", 0)), false);

check(
	"commands waiting for a literal (f/t/r/m) are never swapped",
	plugin.rtlSwapKey(makeCm(ARABIC, 8, { expectLiteral: true }), "h"),
	null,
);

/* -------------------------------------------------------------- modes --- */

plugin.settings.rtlHorizontalSwap = "off";
check("off mode ignores arabic", plugin.rtlSwapKey(rtlCm, "h"), null);

plugin.settings.rtlHorizontalSwap = "always";
check("always mode swaps in english", plugin.rtlSwapKey(ltrCm, "h"), "l");

/* ------------------------------------------------------------- report --- */

let failed = 0;
for (const result of results) {
	console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
	if (!result.ok) {
		failed += 1;
		console.log(`      expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`);
	}
}

console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
