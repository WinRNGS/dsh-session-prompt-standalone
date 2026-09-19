window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-session-prompt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client-props.ts
		/** Kept outside React so the slot prop contract has a cheap regression test. */
		function sessionIdFromProps(props) {
			if (props === null || typeof props !== "object" || props.sessionId === void 0 || props.sessionId === null) throw new TypeError("DSH session slot did not provide the top-level sessionId prop");
			return String(props.sessionId);
		}
		//#endregion
		//#region src/client/index.ts
		/** Input-bar editor for persistent global/workspace prompt layers. */
		const inject = ["slots"];
		const API = "/dsh-session-prompt/api";
		const EMPTY_LAYER = {
			enabled: false,
			prompt: "",
			role: "system",
			order: 20
		};
		const styles = `
.dsp-trigger{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#ccc);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.dsp-trigger:hover,.dsp-btn:hover,.dsp-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#eee);color:var(--dsw-alias-label-primary,#111)}
.dsp-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:blur(2px);padding:16px}
.dsp-box{box-sizing:border-box;width:min(780px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:12px;padding:16px;box-shadow:0 12px 40px rgba(0,0,0,.15);color:var(--dsw-alias-label-primary,#111)}
.dsp-header,.dsp-tabs,.dsp-row,.dsp-actions,.dsp-meta{display:flex;align-items:center;gap:8px}.dsp-header{justify-content:space-between;margin-bottom:10px}.dsp-title{font-size:14px;font-weight:650}.dsp-tabs{margin-bottom:10px}.dsp-tab,.dsp-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1,#ccc);color:var(--dsw-alias-label-secondary,#444);border-radius:7px;padding:5px 12px;font-size:12px;cursor:pointer}.dsp-tab.active{background:var(--dsw-alias-state-business,#4a9eff);border-color:transparent;color:#fff}
.dsp-grid{display:grid;grid-template-columns:minmax(160px,1fr) minmax(160px,1fr);gap:10px;margin-bottom:10px}.dsp-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}.dsp-field select,.dsp-field input[type=number]{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111)}
.dsp-toggle{display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:10px}.dsp-path,.dsp-note{font-size:11px;color:var(--dsw-alias-label-secondary,#666);margin:5px 0 10px;overflow-wrap:anywhere}.dsp-note{line-height:1.5}.dsp-textarea{box-sizing:border-box;width:100%;min-height:150px;resize:vertical;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:8px;padding:9px;font:13px/1.5 ui-monospace,monospace}.dsp-meta{justify-content:space-between;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#666)}
.dsp-msg{margin-top:8px;font-size:12px;white-space:pre-wrap}.dsp-msg.error{color:#d44}.dsp-actions{justify-content:flex-end;margin-top:10px}.dsp-btn.primary{background:var(--dsw-alias-state-business,#4a9eff);border-color:transparent;color:#fff}.dsp-btn.danger{color:#d44}.dsp-btn:disabled,.dsp-tab:disabled{opacity:.45;cursor:not-allowed}
.dsp-preview{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l1,#ddd);padding-top:10px}.dsp-preview h3{font-size:13px;margin:0 0 8px}.dsp-preview details{border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:7px;margin:6px 0;padding:7px 9px}.dsp-preview summary{cursor:pointer;font-size:12px}.dsp-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:230px;overflow:auto;font:11px/1.45 ui-monospace,monospace;margin:8px 0 0}.dsp-empty{font-size:11px;color:var(--dsw-alias-label-secondary,#666)}
@media(max-width:620px){.dsp-grid{grid-template-columns:1fr}.dsp-meta{align-items:flex-start;flex-direction:column}}
`;
		async function readResponse(response) {
			let data;
			try {
				data = await response.json();
			} catch {
				throw new Error(`HTTP ${response.status}`);
			}
			if (!response.ok || !data?.ok) throw new ApiError(response.status, data?.error || `HTTP ${response.status}`);
			return data;
		}
		var ApiError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.status = status;
			}
		};
		function estimate(prompt) {
			const bytes = new TextEncoder().encode(prompt).byteLength;
			return {
				chars: Array.from(prompt).length,
				bytes,
				tokens: prompt ? Math.max(1, Math.ceil(bytes / 4)) : 0
			};
		}
		function PreviewList({ title, entries }) {
			return (0, react.createElement)("div", null, (0, react.createElement)("h3", null, title), entries.length === 0 ? (0, react.createElement)("div", { className: "dsp-empty" }, "当前没有生效段落") : entries.map((entry) => (0, react.createElement)("details", { key: `${title}-${entry.name}-${entry.index}` }, (0, react.createElement)("summary", null, `${entry.index}. ${entry.source} 〔${entry.name}〕`), (0, react.createElement)("pre", null, entry.text))));
		}
		function SystemPromptButton(props) {
			const sessionId = sessionIdFromProps(props);
			const [open, setOpen] = (0, react.useState)(false);
			const [scope, setScope] = (0, react.useState)("global");
			const [layer, setLayer] = (0, react.useState)(EMPTY_LAYER);
			const [workspace, setWorkspace] = (0, react.useState)();
			const [inherited, setInherited] = (0, react.useState)(false);
			const [preview, setPreview] = (0, react.useState)(null);
			const [revision, setRevision] = (0, react.useState)("");
			const [readOnlyReason, setReadOnlyReason] = (0, react.useState)();
			const [recoveryRequired, setRecoveryRequired] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [resetConfirm, setResetConfirm] = (0, react.useState)(false);
			const textareaRef = (0, react.useRef)(null);
			const endpoint = `${API}?scope=${scope}&sessionId=${encodeURIComponent(sessionId)}`;
			const applyData = (data) => {
				setLayer(data.layer);
				setWorkspace(data.workspace);
				setInherited(Boolean(data.inherited));
				setPreview(data.preview);
				setRevision(data.revision);
				setReadOnlyReason(data.readOnlyReason);
				setRecoveryRequired(Boolean(data.recoveryRequired));
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				setLoading(true);
				setMsg(null);
				setResetConfirm(false);
				setRevision("");
				fetch(endpoint).then(readResponse).then((data) => {
					if (!cancelled) applyData(data);
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
			}, [
				open,
				scope,
				sessionId
			]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [open]);
			if (!open) return (0, react.createElement)("button", {
				type: "button",
				className: "dsp-trigger",
				title: "管理全局与工作区提示词注入",
				onClick: () => {
					setScope("global");
					setMsg(null);
					setOpen(true);
				}
			}, "Prompt 注入");
			const save = async () => {
				if (layer.enabled && !layer.prompt.trim()) {
					setMsg({
						text: "启用的段落不能为空",
						error: true
					});
					return;
				}
				setSaving(true);
				setMsg(null);
				try {
					applyData(await readResponse(await fetch(endpoint, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"if-match": `"${revision}"`
						},
						body: JSON.stringify({ layer })
					})));
					setResetConfirm(false);
					setMsg({ text: "已保存；下一次模型请求将使用新结构 ✓" });
				} catch (error) {
					setMsg({
						text: error instanceof ApiError && error.status === 409 ? "保存冲突：设置已被其他窗口或 DSH profile 修改。请关闭后重新打开面板，再合并你的改动。" : "保存失败: " + String(error),
						error: true
					});
				} finally {
					setSaving(false);
				}
			};
			const reset = async () => {
				if (!resetConfirm) {
					setResetConfirm(true);
					setMsg({
						text: scope === "global" ? "再次点击以恢复插件默认全局层。" : "再次点击以删除当前工作区覆盖。",
						error: true
					});
					return;
				}
				setSaving(true);
				try {
					applyData(await readResponse(await fetch(endpoint, {
						method: "DELETE",
						headers: { "if-match": `"${revision}"` }
					})));
					setResetConfirm(false);
					setMsg({ text: scope === "global" ? "全局层已恢复默认值 ✓" : "工作区覆盖已移除 ✓" });
				} catch (error) {
					setMsg({
						text: error instanceof ApiError && error.status === 409 ? "恢复冲突：设置已在其他位置发生变化。请关闭后重新打开面板。" : "恢复失败: " + String(error),
						error: true
					});
				} finally {
					setSaving(false);
				}
			};
			const stats = estimate(layer.prompt);
			const roleNote = layer.role === "system" ? "System：每次模型请求都进入真正的 system prompt；不会覆盖 DSH 原有 Agent Preset。" : "User Context：DSH 将当前快照作为持久 user-role context 投影；内容变化时产生新快照，而不是每轮重复追加。";
			return (0, react.createElement)("div", {
				className: "dsp-modal",
				role: "dialog",
				"aria-modal": true,
				"aria-labelledby": "dsp-title",
				onClick: (event) => {
					if (event.target === event.currentTarget) setOpen(false);
				}
			}, (0, react.createElement)("div", { className: "dsp-box" }, (0, react.createElement)("div", { className: "dsp-header" }, (0, react.createElement)("span", {
				id: "dsp-title",
				className: "dsp-title"
			}, "Prompt 注入设置"), (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn",
				"aria-label": "关闭",
				onClick: () => setOpen(false)
			}, "✕")), (0, react.createElement)("div", { className: "dsp-tabs" }, (0, react.createElement)("button", {
				type: "button",
				className: `dsp-tab${scope === "global" ? " active" : ""}`,
				disabled: loading,
				onClick: () => setScope("global")
			}, "全局默认"), (0, react.createElement)("button", {
				type: "button",
				className: `dsp-tab${scope === "workspace" ? " active" : ""}`,
				disabled: loading,
				onClick: () => setScope("workspace")
			}, "当前工作区")), scope === "workspace" ? (0, react.createElement)("div", { className: "dsp-path" }, workspace ? `工作区：${workspace}${inherited ? "（尚无覆盖）" : ""}` : "正在解析当前工作区…") : null, (0, react.createElement)("label", { className: "dsp-toggle" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: layer.enabled,
				disabled: loading,
				onChange: (event) => setLayer({
					...layer,
					enabled: event.currentTarget.checked
				})
			}), "启用这一层"), (0, react.createElement)("div", { className: "dsp-grid" }, (0, react.createElement)("label", { className: "dsp-field" }, "注入身份", (0, react.createElement)("select", {
				value: layer.role,
				disabled: loading,
				onChange: (event) => setLayer({
					...layer,
					role: event.currentTarget.value
				})
			}, (0, react.createElement)("option", { value: "system" }, "System（强约束）"), (0, react.createElement)("option", { value: "user-context" }, "User Context（聊天上下文）"))), (0, react.createElement)("label", { className: "dsp-field" }, "排序值（越小越靠前）", (0, react.createElement)("input", {
				type: "number",
				min: -1e3,
				max: 1e3,
				step: 1,
				value: layer.order,
				disabled: loading,
				onChange: (event) => setLayer({
					...layer,
					order: Number(event.currentTarget.value)
				})
			}))), (0, react.createElement)("div", { className: "dsp-note" }, roleNote, " 常用参考：Harness Identity = -100，Agent Preset = 0，工具说明通常为 100–199。"), readOnlyReason ? (0, react.createElement)("div", { className: "dsp-msg error" }, `当前设置只读：${readOnlyReason}`) : null, recoveryRequired ? (0, react.createElement)("div", { className: "dsp-msg error" }, "设置 JSON 已损坏；保存前会自动创建恢复备份。请先确认当前内容。") : null, (0, react.createElement)("textarea", {
				ref: textareaRef,
				className: "dsp-textarea",
				value: layer.prompt,
				disabled: loading,
				placeholder: scope === "global" ? "输入全局提示词" : "输入只对当前工作区生效的提示词",
				onChange: (event) => setLayer({
					...layer,
					prompt: event.currentTarget.value
				})
			}), (0, react.createElement)("div", { className: "dsp-meta" }, (0, react.createElement)("span", null, `${stats.chars} 字符 · ${stats.bytes} bytes`), (0, react.createElement)("span", null, `约 ${stats.tokens} tokens（估算）`)), msg ? (0, react.createElement)("div", { className: `dsp-msg${msg.error ? " error" : ""}` }, msg.text) : null, (0, react.createElement)("div", { className: "dsp-actions" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn danger",
				disabled: saving || loading || !revision || readOnlyReason !== void 0,
				onClick: () => {
					reset();
				}
			}, resetConfirm ? "确认恢复" : scope === "global" ? "恢复默认" : "移除覆盖"), (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn",
				disabled: saving,
				onClick: () => setOpen(false)
			}, "关闭"), (0, react.createElement)("button", {
				type: "button",
				className: "dsp-btn primary",
				disabled: saving || loading || !revision || readOnlyReason !== void 0,
				onClick: () => {
					save();
				}
			}, "保存")), preview ? (0, react.createElement)("div", { className: "dsp-preview" }, (0, react.createElement)("div", { className: "dsp-note" }, "以下为当前已生效配置的真实装配结果；编辑后请先保存以刷新。"), (0, react.createElement)(PreviewList, {
				title: "System 段落顺序与来源",
				entries: preview.systemSections
			}), (0, react.createElement)(PreviewList, {
				title: "User Context 段落顺序与来源",
				entries: preview.contexts
			}), (0, react.createElement)("details", null, (0, react.createElement)("summary", null, "最终 System Prompt（完整文本）"), (0, react.createElement)("pre", null, preview.finalSystemPrompt || "（空）")), (0, react.createElement)("details", null, (0, react.createElement)("summary", null, "最终 User Context 快照（完整文本）"), (0, react.createElement)("pre", null, preview.contextSnapshot || "（空）"))) : null));
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