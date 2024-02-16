TODO:
- [ ] logger: {
    trace: [Function (anonymous)],
    debug: [Function (anonymous)],
    info: [Function (anonymous)],
    warn: [Function (anonymous)],
    error: [Function (anonymous)],
    fatal: [Function (anonymous)]
  },

- [x] suspendSender()
- [x] suspendListener()
- [ ] onWaring()
- [ ] express routes:
    - [x] /control
        - [x] suspendListener
        - [x] suspendSender

DONE:
0.0.1
- [x] setSenderTimer() must handle all value by itself
- [x] onData -> handle timer == 0 (send immediatly)
- [x] forward mail Object
- [x] forward Content (also html)
- [x] forward Attachments
- [x] Log in/out
- [x] Check if given emlStorageFolder is directory
- [x] storage on, timer on, sender off -> disable timer
- [x] handle "running"
- [x] Error folder