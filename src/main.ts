import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

type Backend = "hyprland" | "sway" | "unknown";

interface KeyboardState {
	/** Device identifier used by the compositor (hyprctl / swaymsg). */
	name: string;
	/** Currently active layout index for that device. */
	index: number;
}

interface VimLayoutSwitchSettings {
	/** Master switch for the automatic behaviour. */
	enabled: boolean;
	/** Index of the English layout inside your xkb layouts list. */
	englishLayoutIndex: number;
	/** Show a one-time notice when no supported compositor is detected. */
	showNotices: boolean;
	/** Verbose logging in the developer console. */
	debug: boolean;
}

const DEFAULT_SETTINGS: VimLayoutSwitchSettings = {
	enabled: true,
	englishLayoutIndex: 0,
	showNotices: true,
	debug: false,
};

/* -------------------------------------------------------------------------- */
/*  Compositor backends                                                       */
/* -------------------------------------------------------------------------- */

async function detectBackend(): Promise<Backend> {
	if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return "hyprland";
	if (process.env.SWAYSOCK) return "sway";

	try {
		await run("hyprctl", ["version"]);
		return "hyprland";
	} catch {
		/* not Hyprland */
	}

	try {
		await run("swaymsg", ["-t", "get_version", "-r"]);
		return "sway";
	} catch {
		/* not Sway */
	}

	return "unknown";
}

async function readHyprland(): Promise<KeyboardState[]> {
	const { stdout } = await run("hyprctl", ["-j", "devices"]);
	const data = JSON.parse(stdout) as { keyboards?: Record<string, unknown>[] };
	const keyboards = data.keyboards ?? [];
	const result: KeyboardState[] = [];

	for (const kb of keyboards) {
		const name = kb?.["name"];
		if (typeof name !== "string" || !name) continue;
		result.push({ name, index: hyprlandActiveIndex(kb) });
	}

	return result;
}

function hyprlandActiveIndex(kb: Record<string, unknown>): number {
	const direct = kb["active_layout_index"] ?? kb["activeLayoutIndex"];
	if (typeof direct === "number" && Number.isFinite(direct)) return direct;

	// Older Hyprland builds only expose the human readable layout names.
	const keymap = String(kb["active_keymap"] ?? "").toLowerCase();
	const layouts = String(kb["layout"] ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);

	const found = layouts.findIndex((layout) => keymap.startsWith(layout));
	return found >= 0 ? found : 0;
}

async function readSway(): Promise<KeyboardState[]> {
	const { stdout } = await run("swaymsg", ["-t", "get_inputs", "-r"]);
	const inputs = JSON.parse(stdout) as Record<string, unknown>[];
	const result: KeyboardState[] = [];

	for (const input of inputs) {
		if (input?.["type"] !== "keyboard") continue;
		const name = input["identifier"] ?? input["name"];
		if (typeof name !== "string" || !name) continue;
		const index = Number(input["xkb_active_layout_index"] ?? 0);
		result.push({ name, index: Number.isFinite(index) ? index : 0 });
	}

	return result;
}

/* -------------------------------------------------------------------------- */
/*  Obsidian / CodeMirror helpers                                             */
/* -------------------------------------------------------------------------- */

function isVimEnabled(app: App): boolean {
	const anyApp = app as unknown as {
		isVimEnabled?: () => boolean;
		vault?: { getConfig?: (key: string) => unknown };
	};

	if (typeof anyApp.isVimEnabled === "function") {
		try {
			return anyApp.isVimEnabled();
		} catch {
			/* fall through to the vault config */
		}
	}

	try {
		return anyApp.vault?.getConfig?.("vimMode") === true;
	} catch {
		return false;
	}
}

/**
 * Obsidian exposes the CodeMirror instance as `editor.cm.cm` (legacy shim that
 * still emits `vim-mode-change`). Newer builds may hand out the EditorView
 * directly, so both shapes are handled here.
 */
function getCodeMirror(view: MarkdownView): any | null {
	const editor = (view as unknown as { editor?: any }).editor;
	if (!editor) return null;
	const viewOrShim = editor.cm ?? editor;
	return viewOrShim?.cm ?? viewOrShim ?? null;
}

function modeFromVimState(vim: any): string | null {
	if (!vim) return null;
	if (vim.insertMode) return vim.replaceMode ? "replace" : "insert";
	if (vim.visualMode) return "visual";
	return "normal";
}

/* -------------------------------------------------------------------------- */
/*  Plugin                                                                    */
/* -------------------------------------------------------------------------- */

export default class VimLayoutSwitchPlugin extends Plugin {
	settings: VimLayoutSwitchSettings = { ...DEFAULT_SETTINGS };

	private backend: Backend = "unknown";
	private switched = false;
	private saved: KeyboardState[] | null = null;
	private attached = new WeakSet<object>();
	private listeners: { cm: any; handler: (event: { mode?: string }) => void }[] = [];
	private pollId: number | null = null;
	private lastMode: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.backend = await detectBackend();
		if (this.settings.debug) console.debug("[vim-layout-switch] backend:", this.backend);

		this.addSettingTab(new VimLayoutSwitchSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.attach()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.attach()));
		this.registerEvent(this.app.workspace.on("file-open", () => this.attach()));

		this.addCommand({
			id: "switch-to-english-layout",
			name: "Switch keyboard layout to English now",
			callback: () => void this.toEnglish(true),
		});

		this.addCommand({
			id: "restore-previous-layout",
			name: "Restore the previous keyboard layout",
			callback: () => void this.restore(),
		});

		this.app.workspace.onLayoutReady(() => this.attach());

		if (this.backend === "unknown" && this.settings.showNotices) {
			new Notice(
				"Vim Layout Switch needs Hyprland or Sway. No supported compositor was detected.",
				8000,
			);
		}
	}

	onunload(): void {
		this.detachAll();
		this.stopPolling();
		void this.restore();
	}

	/* ---------------------------------------------------------------- attach */

	private attach(): void {
		if (!this.settings.enabled) return;
		if (!isVimEnabled(this.app)) return;
		if (this.backend === "unknown") return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const cm = getCodeMirror(view);
		if (!cm) return;

		if (typeof cm.on === "function") {
			if (this.attached.has(cm)) return;
			const handler = (event: { mode?: string }) => this.handleMode(event?.mode);
			cm.on("vim-mode-change", handler);
			this.attached.add(cm);
			this.listeners.push({ cm, handler });
			if (this.settings.debug) console.debug("[vim-layout-switch] attached (event mode)");
			return;
		}

		// No vim-mode-change emitter available: poll the vim state instead.
		this.startPolling();
	}

	private detachAll(): void {
		for (const { cm, handler } of this.listeners) {
			try {
				cm.off("vim-mode-change", handler);
			} catch {
				/* the editor is already gone */
			}
		}
		this.listeners = [];
		this.attached = new WeakSet<object>();
	}

	/* ------------------------------------------------------------ mode logic */

	private handleMode(mode?: string | null): void {
		if (!mode || mode === this.lastMode) return;
		this.lastMode = mode;

		if (this.settings.debug) console.debug("[vim-layout-switch] mode:", mode);

		if (mode === "insert" || mode === "replace") void this.restore();
		else void this.toEnglish();
	}

	private startPolling(): void {
		if (this.pollId !== null) return;
		this.pollId = window.setInterval(() => this.pollMode(), 150);
		this.registerInterval(this.pollId);
	}

	private stopPolling(): void {
		if (this.pollId === null) return;
		window.clearInterval(this.pollId);
		this.pollId = null;
	}

	private pollMode(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const mode = modeFromVimState(getCodeMirror(view)?.state?.vim);
		this.handleMode(mode);
	}

	/* ------------------------------------------------------------- switching */

	private async toEnglish(force = false): Promise<void> {
		if (this.backend === "unknown") return;
		if (!this.settings.enabled && !force) return;
		if (!force && this.switched) return;

		const state = await this.readState();
		if (!state.length) return;

		const target = this.settings.englishLayoutIndex;
		if (state.every((kb) => kb.index === target)) {
			this.switched = true;
			return;
		}

		if (!this.saved) this.saved = state.map((kb) => ({ ...kb }));

		for (const kb of state) {
			if (kb.index === target) continue;
			await this.switchOne(kb.name, target);
		}

		this.switched = true;
	}

	private async restore(): Promise<void> {
		if (!this.switched && !this.saved) return;

		const snapshot = this.saved;
		this.switched = false;
		this.saved = null;
		this.lastMode = null;

		if (!snapshot) return;

		const current = await this.readState();
		for (const saved of snapshot) {
			const now = current.find((kb) => kb.name === saved.name);
			if (now && now.index === saved.index) continue;
			await this.switchOne(saved.name, saved.index);
			if (now) now.index = saved.index;
		}
	}

	private async readState(): Promise<KeyboardState[]> {
		try {
			if (this.backend === "hyprland") return await readHyprland();
			if (this.backend === "sway") return await readSway();
		} catch (error) {
			this.log("could not read the current layout", error);
		}
		return [];
	}

	private async switchOne(name: string, index: number): Promise<void> {
		try {
			if (this.backend === "hyprland") {
				await run("hyprctl", ["switchxkblayout", name, String(index)]);
			} else if (this.backend === "sway") {
				await run("swaymsg", ["input", name, "xkb_switch_layout", String(index)]);
			}
			if (this.settings.debug) console.debug(`[vim-layout-switch] ${name} -> ${index}`);
		} catch (error) {
			this.log(`could not switch ${name} to layout ${index}`, error);
		}
	}

	/* ----------------------------------------------------------------- misc */

	private log(message: string, error: unknown): void {
		if (!this.settings.debug) return;
		console.error(`[vim-layout-switch] ${message}`, error);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/* -------------------------------------------------------------------------- */
/*  Settings tab                                                              */
/* -------------------------------------------------------------------------- */

class VimLayoutSwitchSettingTab extends PluginSettingTab {
	plugin: VimLayoutSwitchPlugin;

	constructor(app: App, plugin: VimLayoutSwitchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Enable automatic switching")
			.setDesc(
				"Switch to the English layout in normal/visual mode and restore your layout when you enter insert mode.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
					this.plugin.settings.enabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("English layout index")
			.setDesc(
				"Index of the English layout in your xkb layout list, starting from 0. " +
					'For `layouts = us,ara` the English index is 0, for `ara,us` it is 1.',
			)
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.plugin.settings.englishLayoutIndex))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isNaN(parsed) || parsed < 0) return;
						this.plugin.settings.englishLayoutIndex = parsed;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show compatibility notice")
			.setDesc("Warn once when neither Hyprland nor Sway is detected.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showNotices).onChange(async (value) => {
					this.plugin.settings.showNotices = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Print the detected compositor, mode changes and layout switches to the console.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
