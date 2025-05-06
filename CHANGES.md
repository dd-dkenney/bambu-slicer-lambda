# Changelog

## [Unreleased]
### Added
- Support for 3MF files as input format
- Support for OBJ files as input format
- File format validation for STL, 3MF, and OBJ files
- Improved error handling for unsupported file types
- Enhanced logging for file processing 

### Removed
- STEP file support (no longer supported by BambuStudio CLI)

## Previous Changes
### Parameter Updates
The following PHP code was implemented to invoke the Lambda function with additional parameters:

```php
protected function invokeLambda(string $s3Key, array $settings): array
    {
        // If profile_id is provided, fetch the complete profile data
        if (isset($settings['profile_id']) && !empty($settings['profile_id'])) {
            $profile = \DB::table('user_profiles')->where('id', $settings['profile_id'])->first();
            
            if (!$profile) {
                Log::error('Profile not found during lambda invocation', ['profile_id' => $settings['profile_id']]);
                throw new Exception('Profile not found');
            }
            
            // Convert the profile from object to array
            $profileArray = json_decode(json_encode($profile), true);
            
            // Use the profile settings
            $lambdaSettings = $profileArray;
        } else {
            // Use the provided settings directly
            $lambdaSettings = $settings;
        }
        
        // Determine support type
        $supportEnabled = 0; // Default: no support
        if (isset($lambdaSettings['support_type'])) {
            if ($lambdaSettings['support_type'] === 'normal(auto)') {
                $supportEnabled = 1;
            } elseif ($lambdaSettings['support_type'] === 'tree(auto)') {
                $supportEnabled = 2;
            }
        }
        
        // Build the payload with all parameters
        $payload = [
            'Records' => [
                [
                    's3' => [
                        'bucket' => [
                            'name' => config('aws.bucket')
                        ],
                        'object' => [
                            'key' => $s3Key
                        ]
                    ]
                ]
            ],
            'settings' => [
                // Include all original settings
                ...$lambdaSettings,
                // Add formatted settings required by Lambda
                'infillPercentage' => $lambdaSettings['infill_density'] . '%',
                'supportEnabled' => $supportEnabled,
                'infillPattern' => $lambdaSettings['infill_pattern'],
                // Include all required parameters clearly
                'layerHeight' => $lambdaSettings['layer_height'],
                'nozzleDiameter' => $lambdaSettings['nozzle_diameter'],
                'wallLoops' => $lambdaSettings['wall_loops'],
                'topShells' => $lambdaSettings['top_shells'],
                'bottomShells' => $lambdaSettings['bottom_shells'],
                // Include optional parameters if present
                'outerWallSpeed' => $lambdaSettings['outer_wall_speed'] ?? null,
                'innerWallSpeed' => $lambdaSettings['inner_wall_speed'] ?? null,
                'infillSpeed' => $lambdaSettings['infill_speed'] ?? null,
                'travelSpeed' => $lambdaSettings['travel_speed'] ?? null,
                'defaultAcceleration' => $lambdaSettings['default_acceleration'] ?? null,
                'filamentDensity' => $lambdaSettings['filament_density'] ?? null,
                'filamentFlowRatio' => $lambdaSettings['filament_flow_ratio'] ?? null,
                'filamentMaxVolumetricSpeed' => $lambdaSettings['filament_max_volumetric_speed'] ?? null
            ]
        ];
        ```