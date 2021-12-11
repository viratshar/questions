export default class Logout extends HTMLElement {

  constructor() {
    super();
    this.sessionId = this.getAttribute('sessionId');
    console.assert(this.sessionId);
    this.attachShadow({mode: 'open'});
    this.logout = this.logout.bind(this);
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = HTML;
    this.shadowRoot.getElementById('logoutForm')
      .addEventListener('submit', this.logout);
  }

  async logout(ev) {
    ev.preventDefault();
    const loginApp = closestThruShadow(this, 'login-app');
    await loginApp.logout(this.sessionId);
  }
  
}


/** like el.closest(sel), but pierce shadow boundaries */
function closestThruShadow(el, sel) {
  return (!el || el === document || el === window)
    ? null
    : ( el.closest(sel) ?? closestThruShadow(el.getRootNode().host, sel) );
}

const STYLE = `
  :host {
    display: block;
  }
  :host([hidden]) {
    display: none;
  }

  .logout {
    padding: 3em;
  }
`;

const HTML = `
  <style>${STYLE}</style>
  <span id="logout">
    <form id="logoutForm" method="POST">
      <button type="submit">Logout</button>
    </form>
  </span>
`;

	    
//customElements.define('do-logout', Logout);
