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

/* ------------------------------------------------- mixed-script stability --- */

// Regression for the caret ping-pong bug: the direction decision used to come
// from a ±24 character window around the caret, so exactly at an Arabic/English
// boundary the decision flipped with every keypress, the mirrored key reversed,
// and the caret bounced between the two runs instead of crossing them.
// The decision is now the line's majority, so it must be the same value for
// every caret column on the line.

const rtlCount = (text) => (text.match(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
const ltrCount = (text) => (text.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length;

/** All distinct decisions `textDirectionAt` gives as the caret sweeps the line. */
function singleDirection(text) {
	const expected = rtlCount(text) === ltrCount(text)
		? "neutral" // exact ties are covered separately below; not expected here
		: rtlCount(text) > ltrCount(text) ? "rtl" : "ltr";
	const seen = new Set();
	for (let ch = 0; ch <= text.length; ch += 1) seen.add(plugin.textDirectionAt(makeCm(text, ch)));
	return { expected, decisions: [...seen] };
}

const LATIN_RUN = "qwertyuiopasdfghjklzxcvbnm"; // 26 strong letters
const ARABIC_RUN = "ها وهنا عشرون حرفا عربيا على الأقل"; // 28 strong letters

check(
	"arabic-dominant mixed line keeps one direction at every caret column",
	singleDirection(`${ARABIC_RUN} ثم ${LATIN_RUN}`),
	{ expected: "rtl", decisions: ["rtl"] },
);
check(
	"latin-dominant mixed line keeps one direction at every caret column",
	singleDirection(`${LATIN_RUN} ها وهنا عشرون حرفا`),
	{ expected: "ltr", decisions: ["ltr"] },
);
check(
	"the reported case (سي أس أس / CSS) is stable across the boundary",
	singleDirection("سي أس أس CSS"),
	{ expected: "rtl", decisions: ["rtl"] },
);

// An exact 50/50 tie falls back to the first strong letter (like UAX #9 P3):
// a cursor-independent tiebreak that also cannot oscillate.
check("direction tie: first strong letter decides (latin first)", plugin.isRtlAt(makeCm("css منط", 4)), false);
check("direction tie: first strong letter decides (arabic first)", plugin.isRtlAt(makeCm("منط css", 4)), true);

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
