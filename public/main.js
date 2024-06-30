/*global  Vue */

(() => {
  let client = null;
  // const notification = (config) =>
  //   UIkit.notification({
  //     pos: "top-right",
  //     timeout: 5000,
  //     ...config,
  //   });

  // const alert = (message) =>
  //   notification({
  //     message,
  //     status: "danger",
  //   });

  // const info = (message) =>
  //   notification({
  //     message,
  //     status: "success",
  //   });

  // const fetchJson = (...args) =>
  //   fetch(...args)
  //     .then((res) =>
  //       res.ok
  //         ? res.status !== 204
  //           ? res.json()
  //           : null
  //         : res.text().then((text) => {
  //           throw new Error(text);
  //         })
  //     )
  //     .catch((err) => {
  //       alert(err.message);
  //     });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
    },
    methods: {
      // fetchActiveTimers() {
      //   fetchJson("/api/timers?isActive=true").then((activeTimers) => {
      //     this.activeTimers = activeTimers;
      //   });
      // },
      // fetchOldTimers() {
      //   fetchJson("/api/timers?isActive=false").then((oldTimers) => {
      //     this.oldTimers = oldTimers;
      //   });
      // },
      createTimer() {
        const description = this.desc;
        this.desc = "";
        client.send(JSON.stringify({ job: "create_timer", description }));
        // fetchJson("/api/timers", {
        //   method: "post",
        //   headers: {
        //     "Content-Type": "application/json",
        //   },
        //   body: JSON.stringify({ description }),
        // }).then(({ id }) => {
        //   info(`Created new timer "${description}" [${id}]`);
        //   // this.fetchActiveTimers();
        //   client.send(JSON.stringify({ job: 'all_timers' }));
        // });
      },
      stopTimer(id) {
        client.send(JSON.stringify({ job: "stop_timer", id }));

        // fetchJson(`/api/timers/${id}/stop`, {
        //   method: "post",
        // }).then(() => {
        //   info(`Stopped the timer [${id}]`);
        //   client.send(JSON.stringify({ job: 'all_timers' }));
        //   // this.fetchActiveTimers();
        //   // this.fetchOldTimers();
        // });
      },
      formatTime(ts) {
        return new Date(ts).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
      connect() {
        const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
        client = new WebSocket(`${wsProtocol}//${location.host.replace(/\/$/, "")}`);

        client.addEventListener("error", () => {
          console.log("Error");
        });

        client.addEventListener("open", () => {
          // console.log("Connected на клиенте");

          client.send(
            JSON.stringify({
              job: "all_timers",
            })
          );

          setInterval(() => {
            client.send(
              JSON.stringify({
                job: "active_timers",
              })
            );
          }, 1000);
        });

        client.addEventListener("message", (message) => {
          // console.log(message);
          let data;
          try {
            data = JSON.parse(message.data);
          } catch (error) {
            console.error(error);
            return;
          }
          // console.log(data);
          if (data.job === "userID") {
            window.USER_ID = data.id;
          }
          if (data.job === "all_timers") {
            this.activeTimers = data.timers.filter((x) => x.isActive);
            this.oldTimers = data.timers.filter((x) => !x.isActive);
          }

          if (data.job === "active_timers") {
            this.activeTimers = data.timers;
          }
          if (data.job === "stop_timer") {
            client.send(JSON.stringify({ job: "all_timers" }));
          }
        });
      },
    },

    created() {
      this.connect();
    },
  });
})();
