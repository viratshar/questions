import LoginWs from './login-ws.mjs';
import utils from './utils.mjs';

const { AppErrors } = utils;

/** A container for any App.  Ensures that App is displayed only
 *  when user is logged in; otherwise displays a login form.
 */
export default class LoginApp extends HTMLElement {

  constructor() {
    super();

    //grab hold of attributes
    this.wsUrl = this.getAttribute('ws-url');
    this.sessionIdKey = this.getAttribute('session-id-key') ?? 'sessionId';
    this.autoLogoutSeconds =
      Number(this.getAttribute('autoLogoutSeconds') ?? 30);
    this.loginWs = new LoginWs(this.wsUrl);

    //normally, DOM handler called with self set to widget causing event;
    //ensure, self set to this instance always
    this.login = this.login.bind(this);

    //create listener for user activities.
    this.activity = this.activity.bind(this);
    ACTIVITY_EVENTS.forEach(e =>
			    document.addEventListener(e, this.activity, true));

    //set up this.shadowRoot
    this.attachShadow({mode: 'open'});

    //document part of this's state
    this.sessionInfo = undefined;

    //timestamp at which login was last checked on server
    this.lastCheckTime = -1;

    //timestamp at which user activity was last detected on this page
    this.lastActivityTime = -1;

  }

  //called when component added to DOM
  async connectedCallback() {
    await this.checkLogin();
  }

  //called when component removed from DOM; used to clean up
  disconnectedCallback() {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    delete this.logoutTimer;
  }

  //handler called when any user activity detected in page
  activity(ev) { this.lastActivityTime = Date.now(); }
  
  //event handler called when user logs in
  async login(ev) {
    ev.preventDefault();
    //ev.target is submitted form; FormData returns data from loging form
    const formData = new FormData(ev.target);
    const loginResult = await this.loginWs.login(Object.fromEntries(formData));
    if (loginResult.errors) {
      reportErrors(this.shadowRoot, loginResult.errors);
    }
    else {
      const { sessionId } = loginResult;
      //remember sessionId in browser's sessionStorage
      sessionStorage.setItem(this.sessionIdKey, sessionId);
      this.sessionInfo = loginResult;
      this.checkLogin();
    }
  }

  
  /** check if session from sessionStorage is valid.  If it is,
   *  then renew it.  Display login container.
   */
  async checkLogin() {
    const sessionId = sessionStorage.getItem(this.sessionIdKey);
    let isLoggedIn = false;
    if (sessionId) {
      const renewResult = await this.loginWs.renewSession(sessionId);
      if (renewResult.errors) {
	sessionStorage.removeItem(this.sessionIdKey);
	delete this.sessionInfo;
      }
      else {
	isLoggedIn = true;
	this.sessionInfo = renewResult;
	this.lastCheckTime = Date.now();
	this.resetLogoutTimer();
      }
    }
    this.display(isLoggedIn);
  }

  /** depending on isLoggedIn, display either login form or contained app */ 
  display(isLoggedIn) {
    if (isLoggedIn) {
      if (!this.didAppLogin) {
	this.shadowRoot.innerHTML = APP_HTML + LOGOUT_WARNING_HTML;
	const app = this.getApp();
	if (app) dispatchLoginEventToApp(app, this.sessionInfo);
	this.didAppLogin = true;
      }
    }
    else {
      this.shadowRoot.innerHTML = LOGIN_FORM_HTML;
      this.shadowRoot.getElementById('loginForm')
	.addEventListener('submit', this.login);
    }
  }

  async logout(sessionId) {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    await this.loginWs.logout(sessionId);
    delete this.sessionInfo;
    sessionStorage.removeItem(this.sessionIdKey);
    delete this.didAppLogin;
    const app = this.getApp();
    if (app) dispatchLogoutEventToApp(app);
    await this.checkLogin();
  }

  getApp() {
    const appSlot = this.shadowRoot.getElementById('app');
    return appSlot.assignedNodes()[0];
  }

  /** Reset timer which controls logout warning dialog. */
  async resetLogoutTimer() {
    if (this.logoutTimer) clearTimeout(this.logoutTimer);
    const timeLeft = this.sessionInfo.maxAgeSeconds;
    const autoLogout = this.autoLogoutSeconds;
    const timeout =
      (timeLeft < autoLogout) ? timeLeft/2 : timeLeft - autoLogout;
    const dialogSeconds = timeLeft - timeout;
    const timeFn = async () => {
      if (this.lastActivityTime > this.lastCheckTime) {
	await this.checkLogin(); //renew server login and this timer
	return;
      }
      const dialogRet = await logoutWarn(this.shadowRoot, dialogSeconds);
      const doLogout = dialogRet === 'logout';
      if (doLogout) {
	const sessionId = this.sessionInfo?.sessionId;
	if (sessionId) await this.logout(sessionId);
      }
      else {
	this.checkLogin();
      }
    }
    this.logoutTimer = setTimeout(timeFn, timeout*1000);
  }

} //class LoginApp

/** Dispatch login custom event to app component.  sessionInfo
 *  sent as event details.
 */
function dispatchLoginEventToApp(app, sessionInfo) {
  const event = new CustomEvent('login', {
    detail: sessionInfo,
    bubbles: false,
  });
  app.dispatchEvent(event);
}

function dispatchLogoutEventToApp(app) {
  const event = new CustomEvent('logout', {
    bubbles: false,
  });
  app.dispatchEvent(event);
}

/** Display a modal dialog with a counting down logout message along
 *  with two buttons for continuing session or logging out.  If the
 *  logout button is pressed or no button is pressed within
 *  timeoutSeconds, then return a Promise<'logout'>; otherwise
 *  return a Promise<'logoutCancel'>.
 */
async function logoutWarn(doc, timeoutSeconds) {
  const dialogMessageWidget = doc.getElementById('logoutMsg');
  const dialogMessage = dialogMessageWidget.innerHTML;
  const countdownFn = () => {
    timeoutSeconds--;
    dialogMessageWidget.innerHTML =
      dialogMessage.replace('${seconds}', String(timeoutSeconds));
  };
  countdownFn();
  const logoutDialog = doc.getElementById('logoutDialog');
  if (typeof logoutDialog.showModal === 'function') {
    logoutDialog.showModal();
  }
  else { //not supported in firefox or safari
    const msg = 'The <dialog> API is not supported by this browser';
    return new AppErrors().add(msg);
  }
  const countdown = setInterval(countdownFn, 1000);
  return new Promise(resolve => {
    const logoutTimer = setTimeout(() => {
      clearInterval(countdown);
      logoutDialog.close();
      resolve('logout');
    }, timeoutSeconds*1000);
    logoutDialog.addEventListener('close', ev => {
      clearInterval(countdown); clearTimeout(logoutTimer);
      resolve(logoutDialog.returnValue);
    });
  });
}

/** For each err in errors, if there is a widget with id equal to err.widget,
 *  then display err.message in that widget; otherwise display err.message
 *  as a generic error in list .errors.
 */
function reportErrors(doc, errors) {
  //clear all errors
  doc.querySelectorAll('.error').forEach(e => e.innerHTML = '');
  const genericMsgs = [];
  for (const err of errors) {
    const widgetId = err.options?.widget;
    const errWidget = widgetId && doc.getElementById(`err-${widgetId}`);
    const msg = err.message;
    if (errWidget) {
      errWidget.innerHTML = msg;
    }
    else {
      genericMsgs.push(msg);
    }
  }
  doc.getElementById('errors').innerHTML =
    genericMsgs.map(m => `<li>${m}</li>`)
    .join('');
}

const ACTIVITY_EVENTS = [
  'keydown', 'mousedown', 'mousemove', 'scroll',
];

const STYLE = `
  :host {
    display: block;
  }
  :host([hidden]) {
    display: none;
  }

  .grid-form {
    padding-top: 3em;
    display: grid;
    grid-template-columns: 0.5fr 1fr;
    grid-gap: 2vw;
  }
  
  .grid-form input {
    width: 50%;
  }
  
  .grid-form .submit {
    width: 25%;
    color: var(--color09);
  }
  
  label {
    font-weight: bold;
    text-align: right;
  }
  
  
  .error {
    color: red;
  }
`;

//note slots which allow user to customize widget
const LOGIN_FORM_HTML = `
  <style>${STYLE}</style>
  <ul class="error" id="errors"></ul>
  <form id="loginForm" class="grid-form">
    <label for="loginId"><slot name="loginIdLabel">Login ID:</slot></label>
    <span>
      <input name="loginId" id="loginId">
      <br/>
      <span class="error" id="err-loginId"></span>
    </span>
    <label for="pw"><slot name="pwLabel">Password:</slot></label>
    <span>
      <input name="pw" id="pw" type="password">
      <br/>
      <span class="error" id="err-pw"></span>
    </span>
    <label></label>
    <button class="submit" type="submit">
      <slot name=submitLabel>Login</slot>
    </button>
  </form>
`;


//dialog element not supported in Firefox or Safari
//tried to have text for logoutMsg and the  logoutCancel and logout buttons
//slottable.  The slot for logoutMsg worked but the buttons would not show
//up even when their slottability was removed.
const LOGOUT_WARNING_HTML = `
  <dialog id="logoutDialog">
    <form method="dialog">
      <span id="logoutMsg">
        You will be logged out due to inactivity in \${seconds} seconds
      </span>
      <menu>
        <button type="submit" id="logoutCancel" value="logoutCancel">
          Continue
        </button>
        <button type="submit" id="logout" value="logout">
          Logout
        </button>
      </menu>
    </form>
  </dialog>
`;

const APP_HTML = `
  <slot id="app" name="app">App not defined</slot>
`;
	    
//customElements.define('login-app', LoginApp);
