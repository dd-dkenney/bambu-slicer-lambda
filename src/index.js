const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const readline = require('readline');
const xmlStream = require('xml-stream');
const { promisify } = require('util');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const execAsync = promisify(exec);

const TEMP_DIR = '/tmp';
const costPerManHour = 26.00;
const manHourFactor = 0.09375;
const electricityCostPerKWh = 0.14;
const printerMaintenaceCostPerHour = 0.60;
const scrapPercentage = 0.02;
const printerPowerConsumption = 300 / 1000;
const materialCostMultiplier = 3.5;

const filaments = [
    {
        name: 'PolyLite PLA',
        costPerKg: 20.00,
        filamentDensity: 1.24,
        filamentDiameter: 1.75
    }
];

// Create a dynamic filament config based on settings
const createFilamentConfig = (settings) => {
    return {
        name: 'Custom Filament',
        costPerKg: 20.00, // Default cost
        filamentDensity: settings.filamentDensity || 1.24, // Use provided density or default
        filamentDiameter: 1.75 // Default diameter
    };
};

const calculateFilamentWeight = (used_length, filament_diameter, filament_density) => {
    const radiusCM = (filament_diameter / 10) / 2;
    const lengthCM = used_length * 100;
    const volumeCM3 = Math.PI * Math.pow(radiusCM, 2) * lengthCM;
    return volumeCM3 * filament_density;
};

const calculateCost = (usedMeters, printSeconds, filament) => {
    const calculatedMaterialUsage = calculateFilamentWeight(usedMeters, filament.filamentDiameter, filament.filamentDensity);
    const materialCost = (calculatedMaterialUsage * (filament.costPerKg / 1000));
    const materialPrice = materialCost * materialCostMultiplier;
    const manHourEstimate = (printSeconds / 3600) * manHourFactor;
    const manHourCost = manHourEstimate * costPerManHour;
    const electricityCost = (printerPowerConsumption * ((printSeconds / 3600) * electricityCostPerKWh));
    const maintenanceCost = (printerMaintenaceCostPerHour * (printSeconds / 3600));
    const costPerPrintHour = electricityCost + maintenanceCost;

    const totalEstimate = (materialPrice + costPerPrintHour) * (1 + scrapPercentage);
    return {
        materialCost: Math.ceil(materialCost * 100) / 100,
        materialPrice: Math.ceil(materialPrice * 100) / 100,
        manHours: Math.ceil(manHourEstimate * 10) / 10,
        manHourCost: Math.ceil(manHourCost * 100) / 100,
        printerCost: Math.ceil(costPerPrintHour * 100) / 100,
        totalPrintTimeSeconds: printSeconds,
        maintenanceCostPerHour: Math.ceil(costPerPrintHour * 100) / 100,
        electricityCost: Math.ceil(electricityCost * 100) / 100,
        priceEstimate: Math.ceil(totalEstimate * 100) / 100,
        costEstimate: Math.ceil(((calculatedMaterialUsage * (filament.costPerKg / 1000)) + costPerPrintHour) * 100) / 100,
        calculatedFilamentUsage: Math.ceil(calculatedMaterialUsage)
    };
};

// Extract functions from your reference code

async function extractUsedMaterial(output3mf) {
    let usedMeters = 0;

    const usedMaterialStream = fs.createReadStream(output3mf)
        .pipe(unzipper.ParseOne("Metadata/slice_info.config"));

    const streamXml = new xmlStream(usedMaterialStream);

    console.log('Extracting used material...');

    return new Promise((resolve, reject) => {
        streamXml.on('endElement: filament', function (item) {
            if (item.$['used_m']) {
                usedMeters += parseFloat(item.$['used_m']);
            }
        });

        streamXml.on('end', () => resolve(usedMeters));
        streamXml.on('error', (error) => reject(error));
        usedMaterialStream.on('error', (error) => reject(error));
    });
}

async function extractPrintTimeFromDirectory(outputDir) {
    let cumulativeTotalSeconds = 0;
    let totalPlates = 0;
    let platePrintTimes = [];

    console.log('Extracting print time from directory:', outputDir);

    return new Promise((resolve, reject) => {
        fs.readdir(outputDir, (err, files) => {
            if (err) return reject(err);

            const gcodeFiles = files.filter(file => file.endsWith('.gcode'));
            let processedFiles = 0;

            if (gcodeFiles.length === 0) {
                return reject('No .gcode files found in the directory.');
            }

            totalPlates = gcodeFiles.length;

            gcodeFiles.forEach(file => {
                let currentFileSeconds = 0;
                const filePath = path.join(outputDir, file);
                const readInterface = readline.createInterface({
                    input: fs.createReadStream(filePath),
                    console: false
                });

                readInterface.on('line', line => {
                    const timeRegex = /total estimated time: (?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/;
                    const match = line.match(timeRegex);
                    if (match) {
                        const days = parseInt(match[1] || '0', 10);
                        const hours = parseInt(match[2] || '0', 10);
                        const minutes = parseInt(match[3] || '0', 10);
                        const seconds = parseInt(match[4] || '0', 10);
                        currentFileSeconds += (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
                    }
                });

                readInterface.on('close', () => {
                    cumulativeTotalSeconds += currentFileSeconds;
                    platePrintTimes.push(currentFileSeconds);
                    processedFiles++;
                    if (processedFiles === gcodeFiles.length) {
                        resolve({
                            totalSeconds: cumulativeTotalSeconds,
                            plateTimes: platePrintTimes,
                            totalPlates
                        });
                    }
                });
            });
        });
    });
}

async function getObjectDetails(output3mf) {
    return new Promise((resolve, reject) => {
        const results = [];

        fs.createReadStream(output3mf)
            .pipe(unzipper.Parse())
            .on('entry', function (entry) {
                const fileName = entry.path;

                if (fileName.startsWith("Metadata/plate_") && fileName.endsWith(".json")) {
                    let chunks = [];

                    entry.on('data', function (chunk) {
                        chunks.push(chunk);
                    });

                    entry.on('end', function () {
                        const rawData = Buffer.concat(chunks).toString();
                        const data = JSON.parse(rawData);

                        data.bbox_objects.forEach(object => {
                            results.push({
                                objectName: object.name,
                                area: object.area,
                                x: Math.ceil(object.bbox[1]),
                                y: Math.ceil(object.bbox[2]),
                                z: Math.ceil(object.bbox[0])
                            });
                        });
                    });

                } else {
                    entry.autodrain();
                }
            })
            .on('error', (error) => reject(error))
            .on('close', () => resolve(results));
    });
}

async function processFile(fileKey, settings) {
    const fileName = path.basename(fileKey);
    const localFilePath = path.join('/tmp', fileName);
    const outputDir = path.join('/tmp', `output_${Math.random().toString(36).substring(7)}`);
    const output3mfFilename = 'slice.3mf';
    const output3mf = path.join(outputDir, output3mfFilename);

    try {
        console.log('Processing file:', fileKey);
        fs.mkdirSync(outputDir, { recursive: true });

        // Extract settings with defaults
        const {
            infillPercentage = "10%",
            supportEnabled = 1,
            infillPattern = "gyroid",
            layerHeight,
            nozzleDiameter,
            wallLoops,
            topShells, 
            bottomShells,
            outerWallSpeed,
            innerWallSpeed,
            infillSpeed,
            travelSpeed,
            defaultAcceleration,
            filamentDensity,
            filamentFlowRatio,
            filamentMaxVolumetricSpeed,
            supportType = "normal(auto)"
        } = settings;

        // Build command with base parameters
        let command = `LD_LIBRARY_PATH=/home/slicer/BambuStudio/bin /home/slicer/BambuStudio/bin/bambu-studio \
            --info \
            --debug 5 \
            --orient 1 \
            --arrange 1 \
            --allow-rotations \
            --sparse-infill-density="${infillPercentage}" \
            --sparse-infill-pattern="${infillPattern}"`;
            
        // Add optional parameters if provided
        if (supportEnabled) command += ` \\\n            --enable-support="${supportEnabled}"`;
        if (supportEnabled && supportType) command += ` \\\n            --support-type="${supportType}"`;
        if (layerHeight) command += ` \\\n            --layer-height="${layerHeight}"`;
        if (nozzleDiameter) command += ` \\\n            --nozzle-diameter="${nozzleDiameter}"`;
        if (wallLoops) command += ` \\\n            --wall-loops="${wallLoops}"`;
        if (topShells) command += ` \\\n            --top-shell-layers="${topShells}"`;
        if (bottomShells) command += ` \\\n            --bottom-shell-layers="${bottomShells}"`;
        if (outerWallSpeed) command += ` \\\n            --outer-wall-speed="${outerWallSpeed}"`;
        if (innerWallSpeed) command += ` \\\n            --inner-wall-speed="${innerWallSpeed}"`;
        if (infillSpeed) command += ` \\\n            --sparse-infill-speed="${infillSpeed}"`;
        if (travelSpeed) command += ` \\\n            --travel-speed="${travelSpeed}"`;
        if (defaultAcceleration) command += ` \\\n            --default-acceleration="${defaultAcceleration}"`;
        if (filamentDensity) command += ` \\\n            --filament-density="${filamentDensity}"`;
        if (filamentFlowRatio) command += ` \\\n            --filament-flow-ratio="${filamentFlowRatio}"`;
        if (filamentMaxVolumetricSpeed) command += ` \\\n            --filament-max-volumetric-speed="${filamentMaxVolumetricSpeed}"`;
            
        // Add the rest of the command
        command += ` \\\n            --slice 0 \
            --export-slicedata "${outputDir}" \
            --outputdir "${outputDir}" \
            --load-settings "/home/slicer/print_settings/machine.json;/home/slicer/print_settings/process.json" \
            --load-filaments "/home/slicer/print_settings/filament.json" \
            --export-3mf "${output3mfFilename}" \
            "${localFilePath}"`;

        const { stdout, stderr } = await execAsync(command, {
            maxBuffer: 1024 * 1024 * 64 // 64MB buffer
        });

        console.log('Command output:', stdout);
        if (stderr) console.error('Command stderr:', stderr);

        const usedMeters = await extractUsedMaterial(output3mf);
        const objectDetails = await getObjectDetails(output3mf);
        const printTimes = await extractPrintTimeFromDirectory(outputDir);

        // Create a filament configuration based on provided settings
        const filamentConfig = createFilamentConfig(settings);
        
        // Calculate all the costs and details (keep for potential future use)
        const costDetails = calculateCost(usedMeters, printTimes.totalSeconds, filamentConfig);
        
        // Simplified response with only the requested fields
        const results = {
            // Extract just the required bounding box info
            boundingBox: objectDetails.map(obj => ({
                area: obj.area,
                x: obj.x,
                y: obj.y,
                z: obj.z
            })),
            print_time: printTimes.totalSeconds,
            filament_usage: costDetails.calculatedFilamentUsage
        };

        console.log(results);

        console.log('Cleaning up...');
        console.log('Removing output directory:', outputDir);
        fs.rmSync(outputDir, { recursive: true, force: true });

        console.log('Removing local file:', localFilePath);
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
        let settings = {};

        if (event.Records && event.Records[0].s3) {
            const s3Event = event.Records[0].s3;
            const bucket = s3Event.bucket.name;
            const key = decodeURIComponent(s3Event.object.key.replace(/\+/g, ' '));

            // Handle settings from event
            if (event.settings) {
                settings = event.settings;
            } else {
                // Fallback to query string parameters for backward compatibility
                const params = event.queryStringParameters || {};
                settings = {
                    infillPercentage: params.infillPercentage || "10%",
                    supportEnabled: params.supportEnabled || 1,
                    infillPattern: params.infillPattern || "gyroid"
                };
            }

            const s3Object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
            localFilePath = path.join(TEMP_DIR, path.basename(key));
            fs.writeFileSync(localFilePath, s3Object.Body);

        } else if (event.localFilePath) {
            localFilePath = event.localFilePath;
            
            // Extract all the settings from the event
            settings = {
                infillPercentage: event.infillPercentage,
                supportEnabled: event.supportEnabled,
                infillPattern: event.infillPattern,
                layerHeight: event.layerHeight,
                nozzleDiameter: event.nozzleDiameter,
                wallLoops: event.wallLoops,
                topShells: event.topShells,
                bottomShells: event.bottomShells,
                outerWallSpeed: event.outerWallSpeed,
                innerWallSpeed: event.innerWallSpeed,
                infillSpeed: event.infillSpeed,
                travelSpeed: event.travelSpeed,
                defaultAcceleration: event.defaultAcceleration,
                filamentDensity: event.filamentDensity,
                filamentFlowRatio: event.filamentFlowRatio,
                filamentMaxVolumetricSpeed: event.filamentMaxVolumetricSpeed
            };
            
            // Remove undefined values
            Object.keys(settings).forEach(key => 
                settings[key] === undefined && delete settings[key]
            );
        } else {
            throw new Error("No valid input provided. Must include either an S3 event or a local file path.");
        }

        const results = await processFile(localFilePath, settings);

        console.log('Results:', results);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(results)
        };

    } catch (error) {
        console.error('Lambda execution error:', error);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: error.message || "Internal Server Error" }),
        };
    }
};