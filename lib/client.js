window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-session-prompt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/**
		* dsh-session-prompt Web UI — 输入框工具区的 System Prompt 入口。
		*
		* 位置：conversation.input.right（模型选择左侧的小功能区）。
		* 交互：点击按钮 → 弹出模态框 → 查看/编辑/保存 system prompt。
		* 通信：同源 fetch → host webServer API（/dsh-session-prompt/api）。
		* 渲染：React 函数组件（与 DSH 输入栏插槽的 React 渲染器匹配）。
		*/
		const inject = ["slots"];
		const API = "/dsh-session-prompt/api";
		const styles = `
.dsp-trigger{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#ccc);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.dsp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,#eee);color:var(--dsw-alias-label-primary,#111)}
.dsp-trigger:disabled{opacity:.45;cursor:not-allowed}
.dsp-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,blur(2px));padding:16px}
.dsp-modal-box{box-sizing:border-box;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:12px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.15)}
.dsp-modal-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.dsp-modal-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
.dsp-textarea{box-sizing:border-box;width:100%;min-height:120px;resize:vertical;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:8px;padding:8px;font:var(--ds-font-xs-13,13px/1.5 ui-monospace,monospace)}
.dsp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.dsp-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1,#ccc);color:var(--dsw-alias-label-secondary,#444);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;white-space:nowrap}
.dsp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#eee)}
.dsp-btn.primary{background:var(--dsw-alias-state-business,#4a9eff);border-color:transparent;color:#fff}
.dsp-btn:disabled{opacity:.45;cursor:not-allowed}
.dsp-msg{margin-top:8px;font-size:12px;color:var(--dsw-alias-label-primary,#111);white-space:pre-wrap}
.dsp-msg.error{color:#e55}
`;
		function SystemPromptButton() {
			const [open, setOpen] = (0, react.useState)(false);
			const [prompt, setPrompt] = (0, react.useState)("");
			const [msg, setMsg] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const textareaRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				setLoading(true);
				setMsg(null);
				fetch(API).then((r) => r.json()).then((data) => {
					if (cancelled) return;
					if (data?.ok) setPrompt(data.prompt || "");
					else setMsg({
						text: data?.error || "读取失败",
						error: true
					});
				}).catch((error) => {
					if (!cancelled) setMsg({
						text: "读取失败: " + String(error),
						error: true
					});
				}).finally(() => {
					if (!cancelled) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [open]);
			(0, react.useEffect)(() => {
				if (open && textareaRef.current) textareaRef.current.focus();
			}, [open]);
			if (!open) return (0, react.createElement)("button", {
				type: "button",
				className: "dsp-trigger",
				title: "查看/修改会话开头注入的 system prompt",
				onClick: () => {
					setPrompt("");
					setMsg(null);
					setOpen(true);
				}
			}, "System Prompt");
			const save = async () => {
				const next = prompt.trim();
				if (!next) {
					setMsg({
						text: "prompt 不能为空",
						error: true
					});
					return;
				}
				setSaving(true);
				try {
					const data = await (await fetch(API, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ prompt: next })
					})).json();
					if (!data?.ok) throw new Error(data?.error || "保存失败");
					setMsg({ text: "已保存，新会话立即生效 ✓" });
					setTimeout(() => setOpen(false), 600);
				} catch (error) {
					setMsg({
						text: "保存失败: " + String(error),
						error: true
					});
				} finally {
					setSaving(false);
				}
			};
			return (0, react.createElement)("div", {
				className: "dsp-modal",
				onClick: (event) => {
					if (event.target === event.currentTarget) setOpen(false);
				}
			}, (0, react.createElement)("div", { className: "dsp-modal-box" }, (0, react.createElement)("div", { className: "dsp-modal-header" }, (0, react.createElement)("span", { className: "dsp-modal-title" }, "System Prompt"), (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn",
				onClick: () => setOpen(false)
			}, "✕")), (0, react.createElement)("textarea", {
				ref: textareaRef,
				className: "dsp-textarea",
				value: prompt,
				disabled: loading,
				placeholder: "输入每次会话开头注入的 system prompt",
				onChange: (event) => setPrompt(event.currentTarget.value)
			}), msg ? (0, react.createElement)("div", { className: "dsp-msg" + (msg.error ? " error" : "") }, msg.text) : null, (0, react.createElement)("div", { className: "dsp-actions" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn",
				onClick: () => setOpen(false)
			}, "取消"), (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn primary",
				disabled: saving || loading,
				onClick: () => {
					save();
				}
			}, "保存"))));
		}
		function apply(ctx) {
			const style = document.createElement("style");
			style.dataset.dspCss = "dsh-session-prompt";
			style.textContent = styles;
			document.head.appendChild(style);
			ctx.effect(() => {
				const dispose = ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
					name: "conversation.input.right",
					id: "dsh-session-prompt",
					order: -50
				}, SystemPromptButton));
				return () => {
					dispose();
					style.remove();
				};
			}, "dsh-session-prompt: input right control");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map