const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const xmlStream = require('xml-stream');
const { promisify } = require('util');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const execAsync = promisify(exec);

const TEMP_DIR = '/tmp';
const filaments = [
    {
        name: 'PolyLite PLA',
        costPerKg: 20.00,
        filamentDensity: 1.24,
        filamentDiameter: 1.75
    }
];

// Your existing cost calculation functions here...
// (calculateFilamentWeight, calculateCost, etc.)

async function processFile(fileKey, infillPercentage, supportEnabled, infillPattern) {
    const fileName = path.basename(fileKey);
    const localFilePath = path.join('/tmp', fileName);
    const outputDir = path.join('/tmp', `output_${Math.random().toString(36).substring(7)}`);
    const output3mfFilename = 'slice.3mf';
    const output3mf = path.join(outputDir, output3mfFilename);

    try {
        console.log('Processing file:', fileKey);
        // Create output directory
        fs.mkdirSync(outputDir, { recursive: true });

        // Construct BambuStudio command with xvfb-run
        const command = `/usr/local/bin/xvfb-run-safe /home/slicer/BambuStudio.AppImage \
            --info \
            --debug 5 \
            --orient 1 \
            --arrange 1 \
            --allow-rotations \
            --enable-support="${supportEnabled}" \
            --sparse-infill-density="${infillPercentage}" \
            --sparse-infill-pattern="${infillPattern}" \
            --slice 0 \
            --export-slicedata "${outputDir}" \
            --outputdir "${outputDir}" \
            --load-settings "/home/slicer/print_settings/machine.json;/home/slicer/print_settings/process.json" \
            --load-filaments "/home/slicer/print_settings/filament.json" \
            --export-3mf "${output3mfFilename}" \
            "${localFilePath}"`;

        console.log('Executing command:', command);

        const { stdout, stderr } = await execAsync(command, {
            maxBuffer: 1024 * 1024 * 64 // 64MB buffer
        });

        console.log('Command output:', stdout);
        if (stderr) console.error('Command stderr:', stderr);

        // Process results...
        const usedMeters = await extractUsedMaterial(output3mf);
        const objectDetails = await getObjectDetails(output3mf);
        const printTimes = await extractPrintTimeFromDirectory(outputDir);

        // Calculate results...
        const results = {
            cost: calculateCost(usedMeters, printTimes.totalSeconds, filaments[0]),
            boundingBox: objectDetails,
            totalPlates: printTimes.totalPlates,
            plateTimes: printTimes.plateTimes
        };

        // Cleanup
        fs.rmSync(outputDir, { recursive: true, force: true });
        fs.unlinkSync(localFilePath);

        return results;

    } catch (error) {
        console.error('Error processing file:', error);
        throw error;
    }
}

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    try {
        let localFilePath;
        let infillPercentage;
        let supportEnabled;
        let infillPattern;

        // Check if the event contains an S3 event or direct file parameters
        if (event.Records && event.Records[0].s3) {
            // S3 Event: Extract bucket and key, then download file from S3
            const s3Event = event.Records[0].s3;
            const bucket = s3Event.bucket.name;
            const key = decodeURIComponent(s3Event.object.key.replace(/\+/g, ' '));

            // Get parameters from query string if available
            const params = event.queryStringParameters || {};
            infillPercentage = params.infillPercentage || "10%";
            supportEnabled = params.supportEnabled || 1;
            infillPattern = params.infillPattern || "gyroid";

            // Download the file from S3 to a local temporary directory
            const s3Object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
            localFilePath = path.join(TEMP_DIR, path.basename(key));
            console.log(localFilePath);
            console.log("File exists:", fs.existsSync(localFilePath));
            fs.writeFileSync(localFilePath, s3Object.Body);

        } else if (event.localFilePath) {
            // Direct File Path: Use provided file path (for local testing)
            localFilePath = event.localFilePath;
            infillPercentage = event.infillPercentage || "10%";
            supportEnabled = event.supportEnabled || 1;
            infillPattern = event.infillPattern || "gyroid";
        } else {
            throw new Error("No valid input provided. Must include either an S3 event or a local file path.");
        }

        // Process the file
        const results = await processFile(localFilePath, infillPercentage, supportEnabled, infillPattern);

        return {
            statusCode: 200,
            body: JSON.stringify(results)
        };

    } catch (error) {
        console.error('Lambda execution error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};