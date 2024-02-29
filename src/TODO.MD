TODO:
- [x] suspendSender()
- [x] suspendListener()
- [ ] onWaring()
- [ ] express routes:
    - [x] /control
        - [ ] start
        - [ ] stop
        - [ ] set config
        - [x] suspendListener
        - [x] suspendSender
        - [ ] storage list
        - [ ] get status
        - [ ] get info
-[ ] EML_PARKING_BACKUP
-[ ] EML_DIRECT_BACKUP

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