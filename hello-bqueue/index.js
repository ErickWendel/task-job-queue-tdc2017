const Queue = require('bee-queue')
const Winston = require('winston')

const logger = new Winston.Logger({
    level: 'info',
    transports: [
        new (Winston.transports.Console)()
    ]
})

const log = (msg, params) => logger.log('info', `${msg || ''}, ${params || ''}`)
const error = (msg, params) => logger.log('error', `${msg || ''}, ${params || ''}`)
const keys = Object.keys

const mapItemsTask = (items) => {
    const taskName = 'mapItemsTask'
    const queue = new Queue(taskName)

    const job = queue.createJob(items)
    const process = queue.process(30, (job, done) => {

        job.reportProgress(30)
        if (job.data.index % 2 === 1) return done('o índice não é um numero par', null)

        setTimeout(() => {
            job.reportProgress(50)
            setTimeout(() => {
                job.reportProgress(100)
                return done(null, job.data)

            }, 1000)
        }, 1000)
    })

    job.on('progress', function (progress) {
        log(`Job ${job.queue.name}.${job.id} reported progress: ${progress}%`)
    })

    queue.on('job retrying', function (job, err) {

        // log('name', queue.name)
        // log('jobs', keys(queue.jobs))
        // log('client', queue.client)
        // log('bclient', queue.bclient)
        // log('eclient', queue.eclient)
        // log('queued', queue.queued)
        // log('concurrency', queue.concurrency)

        log(`retried: [${queue.name}] retrying: ${job}`)
    })


    queue.on('failed', function (jobId, err) {
        error(`failed - status: [${jobId.status}] failed:[${jobId.data.index}]  error: ${err}`)
    })

    queue.on('succeeded', function (job, result) {
        log(`Job ${job.queue.name}.${job.id} succeeded, result: ${result.name}`)
    })

    return new Promise((resolve, reject) => {
        return job
            .retries(2)
            .save((err, job) => err ? reject(err) : resolve(job))
    })
}

for (let index = 0; index <= 10; index++) {
    mapItemsTask({ 'name': `Erick ${index} - At ${new Date().getTime()}`, index })
}
