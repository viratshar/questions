class AppErrors {
  constructor() {
    this.errors = [];
  }

  add(err) {
    let { message, options={} } = err;
    if (!message) message = err.toString();
    this.errors.push({message, options});
    return this;
  }
  
  toString() { return this.errors.map(e => e.message).join('\n'); }
}


export default { AppErrors, };
