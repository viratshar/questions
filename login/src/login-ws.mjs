import utils from './utils.mjs';

const { AppErrors } = utils;

export default class LoginWs {
  constructor(baseUrl) {
    this.baseUrl = `${baseUrl}/sessions`;
  }

  async login(params) {
    try {
      const response = await fetch(this.baseUrl, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(params),
      });
      return await responseResult(response);
    }
    catch (err) {
      return new AppErrors().add(err);
    }
  }

  async renewSession(sessionId) {
    try {
      const response = await fetch(`${this.baseUrl}/${sessionId}`, {
	method: 'PATCH',
      });
      return await responseResult(response);
    }
    catch (err) {
      return new AppErrors().add(err);
    }
    
  }
 
  async logout(sessionId) {
    try {
      const response = await fetch(`${this.baseUrl}/${sessionId}`, {
	method: 'DELETE',
      });
      return await responseResult(response);
    }
    catch (err) {
      return new AppErrors().add(err);
    }
    
  }
 
 
}

async function responseResult(response) {
  const ret = await response.json();
  if (response.ok) {
    return ret;
  }
  else {
    return  (ret.errors) ? ret : new AppErrors().add(response.statusText);
  }
}
