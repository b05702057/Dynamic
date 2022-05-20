const   express     = require('express'),
	    bodyParser  = require('body-parser'),
        path        = require('node:path'),
        osu         = require('node-os-utils'),
        Hub         = require('cluster-hub')
        util        = require('util');

var hub = new Hub();

var cpu = osu.cpu;


const cluster = require('cluster');

const totalNumCPUs = require("os").cpus().length;

const serverPort = 8080;
const CONNECTION_KEEP_ALIVE_TIMEOUT_MILLISECONDS = 15000;
const REQUEST_LOAD_HUB_MESSAGE = 'requestLoad';
const UPDATE_RESPONSIBLE_SLICES_HUB_MESSAGE = 'updateResponsibleSlices';

if (cluster.isMaster) {
    console.log(`Total num cpus: ${totalNumCPUs}`);
    console.log(`Master pid is: ${process.pid}`);

    let workers = [];

    // Spawn worker at index 'i'.
    let spawn = function(i) {
        workers[i] = cluster.fork();

        // If worker dies, spawn it again
        workers[i].on('exit', function(code, signal) {
            // console.log('respawning worker', i);
            spawn(i);
        });

        // // Check for load request message
        // workers[i].on('message', function(msg) {
        //     // Only intercept messages that have a requestLoad property
        //     if (msg.requestLoad) {
        //         console.log('Worker to master: ');
        //         console.log(msg);

        //         // Send to all workers the msg containing newNamespace
        //         for (var j = 0; j < totalNumCPUs; j++) {
        //             workers[j].send(msg);
        //         }
                
        //     }
        // });
    };

    // Spawn workers
    for (var i = 0; i < totalNumCPUs; i++) {
        spawn(i);
    }

    function hubRequestWorkerRequestLoadPromise(hub, worker) {
        return new Promise((resolve, reject) => {
            hub.requestWorker(worker, REQUEST_LOAD_HUB_MESSAGE, {}, (err, workerRes) => {
                if (err) return reject(err);
                resolve(workerRes);
            });
        })
    }

    // Aggregate slices request counts
    hub.on(REQUEST_LOAD_HUB_MESSAGE, function (data, sender, callback) {
        let all_promises = [];
        for (const worker of workers) {
            all_promises.push(hubRequestWorkerRequestLoadPromise(hub, worker));
        }

        let aggregatedSliceReqCounts = {};
        
        Promise.all(all_promises)
        .then((allWorkersSliceReqCounts) => {
            for (const sliceReqCounts of allWorkersSliceReqCounts) {
                for (const [sliceSerialized, reqCount] of Object.entries(sliceReqCounts)) {
                    // Increment (or initialize to 0 then increment if not exist)
                    aggregatedSliceReqCounts[sliceSerialized] = (aggregatedSliceReqCounts[sliceSerialized] || 0) + reqCount;
                }
            }

            callback(null, aggregatedSliceReqCounts);
        })
        .catch((err) => {
            callback(err, "ERROR in getting load!");
        });
    });

    function hubRequestWorkerUpdateResponsibleSlicesPromise(hub, data, worker) {
        return new Promise((resolve, reject) => {
            hub.requestWorker(worker, UPDATE_RESPONSIBLE_SLICES_HUB_MESSAGE, data, (err, workerRes) => {
                if (err) return reject(err);
                resolve(workerRes);
            });
        })
    }

    hub.on(UPDATE_RESPONSIBLE_SLICES_HUB_MESSAGE, function (data, sender, callback) {
        let all_promises = [];
        for (const worker of workers) {
            all_promises.push(hubRequestWorkerUpdateResponsibleSlicesPromise(hub, data, worker));
        }
        
        Promise.all(all_promises)
        .then((values) => {
            callback(null, "success in updating responsible slices!");
        })
        .catch((err) => {
            callback(err, "ERROR in updating responsible slices!");
        });
    });

} else {
    console.log(`Worker with pid: ${process.pid} running`);

    // TODO TESTING
    let dummy_slice = {start: 10, end: 20};
    // Maps slice to request count
    let slices_info = {};
    slices_info[JSON.stringify(dummy_slice)] = 200; // TODO TESTING
    
    let sorted_responsible_slices = [];


    hub.on(REQUEST_LOAD_HUB_MESSAGE, function (data, sender, callback) {
        callback(null, slices_info);
    });

    hub.on(UPDATE_RESPONSIBLE_SLICES_HUB_MESSAGE, function (data, sender, callback) {
        let new_slices_info = {};
        let new_sorted_responsible_slices = [];
        // Initialize to 0 and push to sorted_responsible_slices array
        for (const slice of data['slicesArray']) {
            new_slices_info[JSON.stringify(slice)] = 0;
            new_sorted_responsible_slices.push(slice);
        };

        new_sorted_responsible_slices.sort((slice_a, slice_b) => {slice_a.start - slice_b.start});

        // Reset data structures
        slices_info = new_slices_info;
        sorted_responsible_slices = new_sorted_responsible_slices;

        console.log(`Worker ${process.pid} updated slices_info and sorted_responsible_slices`);
        // console.log(slices_info);
        // console.log(sorted_responsible_slices);

        callback(null, "Worker successfully updated responsible slices");
    });


    const app = express();
    
    // app.use statements go here

    app.use(bodyParser.json()); // handle json data, needed for axios requests to put things in req.body
    app.use(bodyParser.urlencoded({extended: true}));

    app.set('views', path.join(__dirname, 'views'))
    app.set('view engine', 'ejs')
    
    let userArr = [
        {
            id: "1",
            username: 'FooUser',
            title: 'Mr.'
        },

        {
            id: "2",
            username: 'BarUser',
            title: 'Ms.'
        },
        {
            id: "3",
            username: 'FooBarUser',
            title: 'Sir'
        }
    ];

    app.get('/', (req, res) => {
        console.log(`Worker ${process.pid} serving root`);

        res.send('<h1>ROOT ROUTE!</h1>');
    });

    app.get('/list-users', (req, res) => {
        console.log(`Worker ${process.pid} serving get list-users`);
        res.render('./index', { userArr });
    });

    app.get('/user-info/:userId', (req, res) => {
        const { userId } = req.params;

        console.log(`Worker ${process.pid} serving user-info userId: ${userId}`);

        const user = userArr.find(user => user.id === userId);
        res.send(user);
    });


    app.get('/add-user', (req, res) => {
        console.log(`Worker ${process.pid} serving get add-user`);

        res.render('./add_user');
    });

    app.post('/add-user', (req, res) => {
        console.log(`Worker ${process.pid} serving post add-user`);

        const { title, username } = req.body;

        const foundUser = userArr.find(user => user.username === username);
        if (typeof foundUser === 'undefined') {
            userArr.push({
                id: userArr.length,
                username: username,
                title: title
            });
            res.redirect('/list-users');
        } else {
            res.send("ERROR: USER ALREADY EXISTS!");
        }
    });

    app.get('/long-computation/:N', (req, res) => {
        console.log(`Worker ${process.pid} serving long-computation`);

        const { N } = req.params;

        let sum = 0;

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                sum += i * j;
            }
        }

        res.send({sum});
    });


    // Only directly requested by controller
    app.get('/get-load-info', (req, res) => {
        console.log(`Worker ${process.pid} serving get-load`);

        // Communicate with all processes to aggregate slices req count info
        console.log('Sending hub requestLoad message to master');

        hub.requestMaster(REQUEST_LOAD_HUB_MESSAGE, {}, (err, masterRes) => {
            if (err !== null) {
                console.log('Error requesting load');
                console.log(err);
                // Error code 500
                res.status(500).send({
                    message: 'Error requesting load'
                });
            } else {
                console.log('Got response from master for getting request load:');
                console.log(masterRes);
                // Send back load
                res.send(masterRes);
            }
        });

        // We wont need this because by default we load balance on request rate.
        // TODO TESTING
        cpu.usage()
            .then(cpuPercentage => {
                console.log(`Current cpu usage % is ${cpuPercentage}`);
            });
    });

    // Only directly requested by controller
    app.post('/update-responsible-slices', (req, res) => {
        console.log(`Worker ${process.pid} serving /update-responsible-slices`);

        // Expects slicesArray to be array of objects (not serialized object strings)
        const { slicesArray } = req.body;

        // Data for hub communication
        const data = {
            slicesArray: slicesArray
        };

        // Communicate with master to tell all worker to update slices
        hub.requestMaster(UPDATE_RESPONSIBLE_SLICES_HUB_MESSAGE, data, (err, masterRes) => {
            if (err !== null) {
                console.log('Error updating responsible slices');
                console.log(err);
                // Error code 500
                res.status(500).send({
                    message: 'Error updating responsible slices'
                });
            } else {
                console.log('Got response from master for updating responsible slices:');
                console.log(masterRes);
                // Simply send success message (controller doesn't need data) for this request
                res.send(masterRes);
            }
        });
    });
    
    app.get('*', (req, res) => {
        console.log(`Worker ${process.pid} serving *`);

        res.send('<h1>CATCH ALL ROUTE!</h1>');
    });

    var server = app.listen(serverPort);
    server.keepAliveTimeout = CONNECTION_KEEP_ALIVE_TIMEOUT_MILLISECONDS;
    // server.headersTimeout = 31000; 
}