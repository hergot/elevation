class Stream {
    constructor() {
        this.listeners = {};
    }
    async write(data) {
        if (!this.listeners['data']) {
            return;
        }
        this.listeners['data'].forEach(async (listener) => {
            listener(data);
        });
    }
    on(event, cb) {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(cb);
    }
}

module.exports = Stream;