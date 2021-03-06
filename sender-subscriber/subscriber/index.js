const every = require('every-moment')
const mongojs = require('mongojs')
const db = mongojs('meetup-db')
const products = db.collection('products')
const productsProcess = db.collection('productsProcess')
const Queue = require('bee-queue')

const winston = require('winston')
const logger = new winston.Logger({
    level: 'info',
    transports: [
        new (winston.transports.Console)()
    ]
})

const log = (msg, params) => logger.log('info', `${msg || ''}, ${params || ''}`)
const error = (msg, params) => logger.log('error', `${msg || ''}, ${params || ''}`)

db.on('connect', () => log('database connected'))
db.on('error', (err) => error('database error', err))


const redisConf = {
    prefix: 'bq',
    stallInterval: 5000,
    redis: {
        host: process.env.REDIS_PORT_6379_TCP_ADDR || '127.0.0.1',
        port: process.env.REDIS_PORT_6379_TCP_PORT || 6379,
        db: 0,
        options: {}
    },
    getEvents: true,
    isWorker: true,
    sendEvents: true,
    removeOnSuccess: false,
    catchExceptions: false
}

const updateItemsTask = ids => {
    const taskName = 'updateItemsTask'
    const queue = new Queue(taskName, redisConf)
    const task = queue.createJob(ids)

    const process = queue
        .process((job, done) => {
            return productsProcess
                .update({ name: job.data }, { $set: { status: 'processed' } }, { $multi: true },
                (error, res) => {
                    if (error) return done(error, null)

                    return done(null, res)
                })
        })

    return { task, queue, taskName }
}

const saveItemsTask = items => {
    const taskName = 'saveItemsTask'
    const queue = new Queue(taskName, redisConf)

    const task = queue.createJob(items)
    const process = queue.process((job, done) => products.save(job.data, done))

    return { task, queue, taskName }
}

const mapItemsTask = (items) => {
    const taskName = 'mapItemsTask'
    const queue = new Queue(taskName, redisConf)

    const task = queue.createJob(items)

    const process = queue.process(10, (job, done) => {

        if (!job.data.length) return done('items not is array', null)
        const users = job.data.map(data => {
            const products = data.products.map(item => item.price)
            const total = products.length
            const price = products.reduce((prev, next) => prev + next, 0)
            data._id = undefined
            const user = Object.assign({}, data, { totalPrice: price })
            return user
        })
        return done(null, users)
    })

    return { task, queue, taskName }
}


//simulate error
// return done('items not is array', null)

const runJob = (job) => {


    job.queue.on('error', function (jobId, err) {
        error(`error: [${jobId.queue.name}]  verifyItemsjob.queue: ${err}`)
    })
    job.queue.on('failed', function (jobId, err) {
        error(`failed - status: [${jobId.status}] failed:[${jobId.data.index}]  error: ${err}`)
    })
    job.queue.on('job retrying', function (jobId, err) {
        error(`retried: [${job.taskName}] retrying: ${jobId} - failed but is being retried!`)
    })

    job.queue.on('succeeded', function (job, result) {
        log(`Job ${job.queue.name}.${job.id} succeeded, result: ${Object.keys(result)}`)
    })

    job.queue.on('failed', function (jobId, err) {
        error(`failed: [${job.taskName}] error: ${err}`)
    });

    return new Promise((resolve, reject) => {
        return job.task
            .retries(5)
            .save((err, job) => err ? reject(err) : resolve(job))
    })
}
const mapItems = (items) => runJob(mapItemsTask(items))
const saveItems = (items) => runJob(saveItemsTask(items))
const updateItems = (items) => runJob(updateItemsTask(items))


const verifyItems = (items) =>
    new Promise((resolve, reject) => {
        productsProcess
            .find({ 'status': 'created' },
            { _id: 0 },
            { skip: 0, limit: 1000 },
            (err, success) =>
                err ? reject(err) : resolve(success))
    })


const runTasks = async (items) => {
    try {

        const mapped = await mapItems(items)
        const saved = await saveItems(mapped.data)
        const names = items.map(i => i.name)
        const updates = await names.map(name => updateItems(name))

        return updates
    }
    catch (e) {
        error(e)
    }
}

async function runCron() {
    every(1, 'second', async function () {
        log('verifing items....')
        const items = await verifyItems()
        log(`processing ${items.length} items....`)

        if (items.length === 0) {
            log('empty items', items.length)
            return
        }
        log('running tasks items....')
        const tasks = await runTasks(items)


    })
}
runCron()

