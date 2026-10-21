/**
 * Minimal runtime stub for the `obsidian` module so the plugin can be loaded
 * in Node during tests. Only the surface used at import time is provided.
 */
class Plugin {
	constructor() {
		this.app = global.__app;
	}
	registerEvent() {}
	registerDomEvent() {}
	registerInterval() {}
	addCommand() {}
	addSettingTab() {}
	async loadData() {
		return {};
	}
	async saveData() {}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
	}
}

class Setting {
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	addToggle() {
		return this;
	}
	addText() {
		return this;
	}
	addDropdown() {
		return this;
	}
}

class Notice {}
class MarkdownView {}

module.exports = { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, App: class {} };
