/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/feedback';
import { localize } from 'vs/nls';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IIntegrityService } from 'vs/workbench/services/integrity/common/integrity';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { editorWidgetBackground, editorWidgetForeground, widgetShadow, inputBorder, inputForeground, inputBackground, inputActiveOptionBorder, editorBackground, textLinkForeground, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { append, $, addDisposableListener, EventType, EventHelper, prepend } from 'vs/base/browser/dom';
import { IAnchor } from 'vs/base/browser/ui/contextview/contextview';
import { Button } from 'vs/base/browser/ui/button/button';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { IStatusbarService } from 'vs/workbench/services/statusbar/browser/statusbar';
import { IProductService } from 'vs/platform/product/common/productService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter } from 'vs/base/common/event';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { defaultButtonStyles } from 'vs/platform/theme/browser/defaultStyles';

export interface IFeedback {
	feedback: string;
	sentiment: number;
}

export interface IFeedbackDelegate {
	submitFeedback(feedback: IFeedback, openerService: IOpenerService): void;
	getCharacterLimit(sentiment: number): number;
}

export interface IFeedbackWidgetOptions {
	feedbackService: IFeedbackDelegate;
}

export class FeedbackWidget extends Disposable {
	private visible: boolean | undefined;
	private _onDidChangeVisibility = new Emitter<boolean>();
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private maxFeedbackCharacters: number;

	private feedback: string = '';
	private sentiment: number = 1;

	private readonly feedbackDelegate: IFeedbackDelegate;

	private feedbackForm: HTMLFormElement | undefined = undefined;
	private feedbackDescriptionInput: HTMLTextAreaElement | undefined = undefined;
	private smileyInput: HTMLElement | undefined = undefined;
	private frownyInput: HTMLElement | undefined = undefined;
	private sendButton: Button | undefined = undefined;
	private hideButton: HTMLInputElement | undefined = undefined;
	private remainingCharacterCount: HTMLElement | undefined = undefined;

	private requestFeatureLink: string | undefined;

	private isPure: boolean = true;

	constructor(
		options: IFeedbackWidgetOptions,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ICommandService private readonly commandService: ICommandService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IIntegrityService private readonly integrityService: IIntegrityService,
		@IThemeService private readonly themeService: IThemeService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IProductService productService: IProductService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super();

		this.feedbackDelegate = options.feedbackService;
		this.maxFeedbackCharacters = this.feedbackDelegate.getCharacterLimit(this.sentiment);

		if (productService.sendASmile) {
			this.requestFeatureLink = productService.sendASmile.requestFeatureUrl;
		}

		this.integrityService.isPure().then(result => {
			if (!result.isPure) {
				this.isPure = false;
			}
		});

		// Hide feedback widget whenever notifications appear
		this._register(this.layoutService.onDidChangeNotificationsVisibility(visible => {
			if (visible) {
				this.hide();
			}
		}));
	}

	private getAnchor(): HTMLElement | IAnchor {
		const dimension = this.layoutService.dimension;

		return {
			x: dimension.width - 8,
			y: dimension.height - 31
		};
	}

	private renderContents(container: HTMLElement): IDisposable {
		const disposables = new DisposableStore();

		container.classList.add('monaco-menu-container');

		// Form
		this.feedbackForm = append<HTMLFormElement>(container, $('form.feedback-form'));
		this.feedbackForm.setAttribute('action', 'javascript:void(0);');

		// Title
		append(this.feedbackForm, $('h2.title')).textContent = localize("label.sendASmile", "Tweet us your feedback.");

		// Close Button (top right)
		const closeBtn = append(this.feedbackForm, $(`div.cancel${Codicon.close.cssSelector}`));
		closeBtn.tabIndex = 0;
		closeBtn.setAttribute('role', 'button');
		closeBtn.title = localize('close', "Close");

		disposables.add(addDisposableListener(container, EventType.KEY_DOWN, keyboardEvent => {
			const standardKeyboardEvent = new StandardKeyboardEvent(keyboardEvent);
			if (standardKeyboardEvent.keyCode === KeyCode.Escape) {
				this.hide();
			}
		}));

		disposables.add(addDisposableListener(closeBtn, EventType.MOUSE_OVER, () => {
			const theme = this.themeService.getColorTheme();
			let darkenFactor: number | undefined;
			switch (theme.type) {
				case 'light':
					darkenFactor = 0.1;
					break;
				case 'dark':
					darkenFactor = 0.2;
					break;
			}

			if (darkenFactor) {
				const backgroundBaseColor = theme.getColor(editorWidgetBackground);
				if (backgroundBaseColor) {
					const backgroundColor = backgroundBaseColor.darken(darkenFactor);
					if (backgroundColor) {
						closeBtn.style.backgroundColor = backgroundColor.toString();
					}
				}
			}
		}));

		disposables.add(addDisposableListener(closeBtn, EventType.MOUSE_OUT, () => {
			closeBtn.style.backgroundColor = '';
		}));

		this.invoke(closeBtn, disposables, () => this.hide());

		// Content
		const content = append(this.feedbackForm, $('div.content'));

		// Sentiment Buttons
		const sentimentContainer = append(content, $('div'));

		if (!this.isPure) {
			append(sentimentContainer, $('span')).textContent = localize("patchedVersion1", "Your installation is corrupt.");
			sentimentContainer.appendChild(document.createElement('br'));
			append(sentimentContainer, $('span')).textContent = localize("patchedVersion2", "Please specify this if you submit a bug.");
			sentimentContainer.appendChild(document.createElement('br'));
		}

		append(sentimentContainer, $('span')).textContent = localize("sentiment", "How was your experience?");

		const feedbackSentiment = append(sentimentContainer, $('div.feedback-sentiment'));

		// Sentiment: Smiley
		this.smileyInput = append(feedbackSentiment, $('div.sentiment'));
		this.smileyInput.classList.add('smile');
		this.smileyInput.setAttribute('aria-checked', 'false');
		this.smileyInput.setAttribute('aria-label', localize('smileCaption', "Happy Feedback Sentiment"));
		this.smileyInput.setAttribute('role', 'checkbox');
		this.smileyInput.title = localize('smileCaption', "Happy Feedback Sentiment");
		this.smileyInput.tabIndex = 0;

		this.invoke(this.smileyInput, disposables, () => this.setSentiment(true));

		// Sentiment: Frowny
		this.frownyInput = append(feedbackSentiment, $('div.sentiment'));
		this.frownyInput.classList.add('frown');
		this.frownyInput.setAttribute('aria-checked', 'false');
		this.frownyInput.setAttribute('aria-label', localize('frownCaption', "Sad Feedback Sentiment"));
		this.frownyInput.setAttribute('role', 'checkbox');
		this.frownyInput.title = localize('frownCaption', "Sad Feedback Sentiment");
		this.frownyInput.tabIndex = 0;

		this.invoke(this.frownyInput, disposables, () => this.setSentiment(false));

		if (this.sentiment === 1) {
			this.smileyInput.classList.add('checked');
			this.smileyInput.setAttribute('aria-checked', 'true');
		} else {
			this.frownyInput.classList.add('checked');
			this.frownyInput.setAttribute('aria-checked', 'true');
		}

		// Contact Us Box
		const contactUsContainer = append(content, $('div.contactus'));

		append(contactUsContainer, $('span')).textContent = localize("other ways to contact us", "Other ways to contact us");

		const channelsContainer = append(contactUsContainer, $('div.channels'));

		// Contact: Submit a Bug
		const submitBugLinkContainer = append(channelsContainer, $('div'));

		const submitBugLink = append(submitBugLinkContainer, $('a'));
		submitBugLink.setAttribute('target', '_blank');
		submitBugLink.setAttribute('href', '#');
		submitBugLink.textContent = localize("submit a bug", "Submit a bug");
		submitBugLink.tabIndex = 0;

		disposables.add(addDisposableListener(submitBugLink, 'click', e => {
			EventHelper.stop(e);
			const actionId = 'workbench.action.openIssueReporter';
			this.commandService.executeCommand(actionId);
			this.hide();
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: actionId, from: 'feedback' });
		}));

		// Contact: Request a Feature
		if (!!this.requestFeatureLink) {
			const requestFeatureLinkContainer = append(channelsContainer, $('div'));

			const requestFeatureLink = append(requestFeatureLinkContainer, $('a'));
			requestFeatureLink.setAttribute('target', '_blank');
			requestFeatureLink.setAttribute('href', this.requestFeatureLink);
			requestFeatureLink.textContent = localize("request a missing feature", "Request a missing feature");
			requestFeatureLink.tabIndex = 0;

			disposables.add(addDisposableListener(requestFeatureLink, 'click', e => this.hide()));
		}

		// Remaining Characters
		const remainingCharacterCountContainer = append(this.feedbackForm, $('h3'));
		remainingCharacterCountContainer.textContent = localize("tell us why", "Tell us why?");

		this.remainingCharacterCount = append(remainingCharacterCountContainer, $('span.char-counter'));
		this.remainingCharacterCount.textContent = this.getCharCountText(0);

		// Feedback Input Form
		this.feedbackDescriptionInput = append<HTMLTextAreaElement>(this.feedbackForm, $('textarea.feedback-description'));
		this.feedbackDescriptionInput.rows = 3;
		this.feedbackDescriptionInput.maxLength = this.maxFeedbackCharacters;
		this.feedbackDescriptionInput.textContent = this.feedback;
		this.feedbackDescriptionInput.required = true;
		this.feedbackDescriptionInput.setAttribute('aria-label', localize("feedbackTextInput", "Tell us your feedback"));
		this.feedbackDescriptionInput.focus();

		disposables.add(addDisposableListener(this.feedbackDescriptionInput, 'keyup', () => this.updateCharCountText()));

		// Feedback Input Form Buttons Container
		const buttonsContainer = append(this.feedbackForm, $('div.form-buttons'));

		// Checkbox: Hide Feedback Smiley
		const hideButtonContainer = append(buttonsContainer, $('div.hide-button-container'));

		this.hideButton = append(hideButtonContainer, $('input.hide-button')) as HTMLInputElement;
		this.hideButton.type = 'checkbox';
		this.hideButton.checked = true;
		this.hideButton.id = 'hide-button';

		const hideButtonLabel = append(hideButtonContainer, $('label'));
		hideButtonLabel.setAttribute('for', 'hide-button');
		hideButtonLabel.textContent = localize('showFeedback', "Show Feedback Icon in Status Bar");

		// Button: Send Feedback
		this.sendButton = new Button(buttonsContainer, defaultButtonStyles);
		this.sendButton.enabled = false;
		this.sendButton.label = localize('tweet', "Tweet");
		prepend(this.sendButton.element, $(`span${Codicon.twitter.cssSelector}`));
		this.sendButton.element.classList.add('send');
		this.sendButton.element.title = localize('tweetFeedback', "Tweet Feedback");

		this.sendButton.onDidClick(() => this.onSubmit());

		disposables.add(attachStylerCallback(this.themeService, { widgetShadow, editorWidgetBackground, editorWidgetForeground, inputBackground, inputForeground, inputBorder, editorBackground, contrastBorder }, colors => {
			if (this.feedbackForm) {
				this.feedbackForm.style.backgroundColor = colors.editorWidgetBackground ? colors.editorWidgetBackground.toString() : '';
				this.feedbackForm.style.color = colors.editorWidgetForeground ? colors.editorWidgetForeground.toString() : '';
				this.feedbackForm.style.boxShadow = colors.widgetShadow ? `0 0 8px 2px ${colors.widgetShadow}` : '';
				this.feedbackForm.style.border = colors.widgetBorder ? `1px solid ${colors.widgetBorder}` : '';
			}
			if (this.feedbackDescriptionInput) {
				this.feedbackDescriptionInput.style.backgroundColor = colors.inputBackground ? colors.inputBackground.toString() : '';
				this.feedbackDescriptionInput.style.color = colors.inputForeground ? colors.inputForeground.toString() : '';
				this.feedbackDescriptionInput.style.border = `1px solid ${colors.inputBorder || 'transparent'}`;
			}

			contactUsContainer.style.backgroundColor = colors.editorBackground ? colors.editorBackground.toString() : '';
			contactUsContainer.style.border = `1px solid ${colors.contrastBorder || 'transparent'}`;
		}));

		return {
			dispose: () => {
				this.feedbackForm = undefined;
				this.feedbackDescriptionInput = undefined;
				this.smileyInput = undefined;
				this.frownyInput = undefined;

				disposables.dispose();
			}
		};
	}

	private updateFeedbackDescription() {
		if (this.feedbackDescriptionInput && this.feedbackDescriptionInput.textLength > this.maxFeedbackCharacters) {
			this.feedbackDescriptionInput.value = this.feedbackDescriptionInput.value.substring(0, this.maxFeedbackCharacters);
		}
	}

	private getCharCountText(charCount: number): string {
		const remaining = this.maxFeedbackCharacters - charCount;
		const text = (remaining === 1)
			? localize("character left", "character left")
			: localize("characters left", "characters left");

		return `(${remaining} ${text})`;
	}

	private updateCharCountText(): void {
		if (this.feedbackDescriptionInput && this.remainingCharacterCount && this.sendButton) {
			this.remainingCharacterCount.innerText = this.getCharCountText(this.feedbackDescriptionInput.value.length);
			this.sendButton.enabled = this.feedbackDescriptionInput.value.length > 0;
		}
	}

	private setSentiment(smile: boolean): void {
		if (smile) {
			if (this.smileyInput) {
				this.smileyInput.classList.add('checked');
				this.smileyInput.setAttribute('aria-checked', 'true');
			}
			if (this.frownyInput) {
				this.frownyInput.classList.remove('checked');
				this.frownyInput.setAttribute('aria-checked', 'false');
			}
		} else {
			if (this.frownyInput) {
				this.frownyInput.classList.add('checked');
				this.frownyInput.setAttribute('aria-checked', 'true');
			}
			if (this.smileyInput) {
				this.smileyInput.classList.remove('checked');
				this.smileyInput.setAttribute('aria-checked', 'false');
			}
		}

		this.sentiment = smile ? 1 : 0;
		this.maxFeedbackCharacters = this.feedbackDelegate.getCharacterLimit(this.sentiment);
		this.updateFeedbackDescription();
		this.updateCharCountText();
		if (this.feedbackDescriptionInput) {
			this.feedbackDescriptionInput.maxLength = this.maxFeedbackCharacters;
		}
	}

	private invoke(element: HTMLElement, disposables: DisposableStore, callback: () => void): HTMLElement {
		disposables.add(addDisposableListener(element, 'click', callback));

		disposables.add(addDisposableListener(element, 'keypress', e => {
			if (e instanceof KeyboardEvent) {
				const keyboardEvent = <KeyboardEvent>e;
				if (keyboardEvent.keyCode === 13 || keyboardEvent.keyCode === 32) { // Enter or Spacebar
					callback();
				}
			}
		}));

		return element;
	}

	show(): void {
		if (this.visible) {
			return;
		}

		this.visible = true;
		this.contextViewService.showContextView({
			getAnchor: () => this.getAnchor(),

			render: (container) => {
				return this.renderContents(container);
			},

			onDOMEvent: (e, activeElement) => {
				this.onEvent(e, activeElement);
			},

			onHide: () => this._onDidChangeVisibility.fire(false)
		});

		this._onDidChangeVisibility.fire(true);

		this.updateCharCountText();
	}

	hide(): void {
		if (!this.visible) {
			return;
		}

		if (this.feedbackDescriptionInput) {
			this.feedback = this.feedbackDescriptionInput.value;
		}

		if (this.hideButton && !this.hideButton.checked) {
			this.statusbarService.updateEntryVisibility('status.feedback', false);
		}

		this.visible = false;
		this.contextViewService.hideContextView();
	}

	isVisible(): boolean {
		return !!this.visible;
	}

	private onEvent(e: Event, activeElement: HTMLElement): void {
		if (e instanceof KeyboardEvent) {
			const keyboardEvent = <KeyboardEvent>e;
			if (keyboardEvent.keyCode === 27) { // Escape
				this.hide();
			}
		}
	}

	private onSubmit(): void {
		if (!this.feedbackForm || !this.feedbackDescriptionInput || (this.feedbackForm.checkValidity && !this.feedbackForm.checkValidity())) {
			return;
		}

		this.feedbackDelegate.submitFeedback({
			feedback: this.feedbackDescriptionInput.value,
			sentiment: this.sentiment
		}, this.openerService);

		this.hide();
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	// Sentiment Buttons
	const inputActiveOptionBorderColor = theme.getColor(inputActiveOptionBorder);
	if (inputActiveOptionBorderColor) {
		collector.addRule(`.monaco-workbench .feedback-form .sentiment.checked { border: 1px solid ${inputActiveOptionBorderColor}; }`);
	}

	// Links
	const linkColor = theme.getColor(textLinkForeground) || theme.getColor(contrastBorder);
	if (linkColor) {
		collector.addRule(`.monaco-workbench .feedback-form .content .channels a { color: ${linkColor}; }`);
	}
});
