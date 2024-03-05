TODO:

- [ ] express routes:
    - [x] /control
        - [ ] set config
        - [x] suspendListener
        - [x] suspendSender
        - [x] storage list
        - [x] get status

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
1.0.0
- [x] suspendSender()
- [x] suspendListener()
- [x] onWaring()
- [x] EML_PARKING_BACKUP
- [x] EML_DIRECT_BACKUP
- [x] eml filenames with email