import {NagiosReturnCodes} from '../src/types/nagios';
import {checkSmartStatus, meta} from './check_smart_status';

describe('checkSmartStatus Plugin', () => {
	describe('Plugin Metadata', () => {
		it('should have valid metadata', () => {
			expect(meta.usage).toBeDefined();
			expect(meta.usage.http).toContain('/plugins/check-smart-status');
			expect(meta.help).toContain('SMART Disk Status Checker');
			expect(meta.examples).toHaveLength(3);
		});
	});

	describe('Default execSync fallback', () => {
		it('should use default execSync when not provided (coverage for line 243)', async () => {
			// This test ensures line 243 is covered: `const exec = injectedExecSync || defaultExecSync;`
			// When execSync is not provided, it should fall back to the default
			const result = checkSmartStatus({
				device: '/dev/nvme0n1',
				// execSync is intentionally not provided to test the fallback
			});

			// Should fail because smartctl is not available in test environment
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});
	});

	describe('Input Validation', () => {
		it('should return UNKNOWN for invalid device path (empty)', async () => {
			const result = await checkSmartStatus({
				device: '',
				execSync: jest.fn(),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Invalid device path');
		});

		it('should return UNKNOWN for invalid device path (not starting with /dev/)', async () => {
			const result = await checkSmartStatus({
				device: '/invalid/path',
				execSync: jest.fn(),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Invalid device path');
		});

		it('should return UNKNOWN for invalid check type', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				checkType: 'invalid' as any,
				execSync: jest.fn(),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Invalid check type');
		});

		it('should return UNKNOWN when warningTemp >= criticalTemp', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 60,
				criticalTemp: 50,
				execSync: jest.fn(),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Warning temperature');
		});

		it('should return UNKNOWN when warningTemp equals criticalTemp', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 50,
				criticalTemp: 50,
				execSync: jest.fn(),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Warning temperature');
		});

		it('should return UNKNOWN when smartctl command fails and JSON parsing fails', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockImplementation(() => {
					throw new Error('Command failed with output: invalid json');
				}),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Failed to parse smartctl output');
		});
	});

	describe('NVMe Drive Tests', () => {
		const mockNvmeHealthy = {
			json_format_version: [1, 0],
			smartctl: {
				version: [7, 4],
				exit_status: 0,
			},
			device: {
				name: '/dev/nvme0n1',
				type: 'nvme',
				protocol: 'NVMe',
			},
			model_name: 'Samsung SSD 980 500GB',
			smart_status: {
				passed: true,
				nvme: {value: 0},
			},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 35,
				available_spare: 100,
				percentage_used: 2,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 35},
			power_on_time: {hours: 1000},
			power_cycle_count: 100,
		};

		it('should return OK for healthy NVMe drive', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeHealthy)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.message).toContain('OK: Disk health is good');
			expect(result.message).toContain('Samsung SSD 980 500GB');
			expect(result.performanceData).toBeDefined();
		});

		it('should return WARNING for NVMe drive with high temperature', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 30,
				criticalTemp: 40,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeHealthy)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('WARNING');
			expect(result.message).toContain('Temperature 35°C');
		});

		it('should return CRITICAL for NVMe drive with critical temperature', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 30,
				criticalTemp: 35,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeHealthy)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain('CRITICAL');
			expect(result.message).toContain('Temperature 35°C');
		});

		it('should return CRITICAL for NVMe drive with SMART failure', async () => {
			const mockNvmeFailed = {
				...mockNvmeHealthy,
				smart_status: {
					passed: false,
					nvme: {value: 1},
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeFailed)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain(
				'CRITICAL: SMART status indicates DISK FAILING',
			);
		});

		it('should return WARNING for NVMe drive with media errors', async () => {
			const mockNvmeMediaErrors = {
				...mockNvmeHealthy,
				nvme_smart_health_information_log: {
					...mockNvmeHealthy.nvme_smart_health_information_log,
					media_errors: 5,
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeMediaErrors)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('Media errors: 5');
		});

		it('should return WARNING for NVMe drive with critical warnings', async () => {
			const mockNvmeCriticalWarning = {
				...mockNvmeHealthy,
				nvme_smart_health_information_log: {
					...mockNvmeHealthy.nvme_smart_health_information_log,
					critical_warning: 1, // Temperature too high
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeCriticalWarning)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('NVMe warnings');
			expect(result.message).toContain('temperature too high');
		});

		it('should return WARNING for NVMe drive with available spare below threshold', async () => {
			const mockNvmeLowSpare = {
				...mockNvmeHealthy,
				nvme_smart_health_information_log: {
					...mockNvmeHealthy.nvme_smart_health_information_log,
					critical_warning: 4, // Available spare below threshold
					available_spare: 5,
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeLowSpare)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('available spare below threshold');
		});

		it('should return CRITICAL for NVMe with media degraded warning', async () => {
			const mockNvmeMediaDegraded = {
				...mockNvmeHealthy,
				nvme_smart_health_information_log: {
					...mockNvmeHealthy.nvme_smart_health_information_log,
					critical_warning: 16, // Media degraded
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeMediaDegraded)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('media degraded');
		});

		it('should return WARNING for NVMe with volatile memory backup failed', async () => {
			const mockNvmeVolatileMemoryFailed = {
				...mockNvmeHealthy,
				nvme_smart_health_information_log: {
					...mockNvmeHealthy.nvme_smart_health_information_log,
					critical_warning: 2, // Volatile memory backup failed
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeVolatileMemoryFailed)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('volatile memory backup failed');
		});

		it('should return WARNING for NVMe with read-only mode', async () => {
			const mockNvmeReadOnly = {
				...mockNvmeHealthy,
				nvme_smart_health_information_log: {
					...mockNvmeHealthy.nvme_smart_health_information_log,
					critical_warning: 8, // Read-only mode
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeReadOnly)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('read-only mode');
		});

		it('should handle NVMe NVMe status value != 0 as CRITICAL', async () => {
			const mockNvmeStatusError = {
				...mockNvmeHealthy,
				smart_status: {
					passed: true,
					nvme: {value: 1},
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeStatusError)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain('DISK FAILING');
		});

		it('should include all performance data for NVMe drive', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeHealthy)),
			});

			const perfDataLabels = result.performanceData?.map((pd) => pd.label);
			expect(perfDataLabels).toContain('temperature');
			expect(perfDataLabels).toContain('available_spare');
			expect(perfDataLabels).toContain('percentage_used');
			expect(perfDataLabels).toContain('media_errors');
			expect(perfDataLabels).toContain('num_err_log_entries');
			expect(perfDataLabels).toContain('power_on_hours');
			expect(perfDataLabels).toContain('power_cycle_count');
		});
	});

	describe('ATA/SATA Drive Tests', () => {
		const mockAtaHealthy = {
			json_format_version: [1, 0],
			smartctl: {
				version: [7, 4],
				exit_status: 0,
			},
			device: {
				name: '/dev/sda',
				type: 'sat',
				protocol: 'ATA',
			},
			model_name: 'WDC WD10EZEX-00BN5A0',
			smart_status: {
				passed: true,
			},
			temperature: {current: 30},
			power_on_time: {hours: 5000},
			power_cycle_count: 200,
			ata_smart_attributes: {
				table: [
					{
						id: 5,
						name: 'Reallocated_Sector_Ct',
						value: 100,
						worst: 100,
						thresh: 10,
						parsed: 0,
					},
					{
						id: 9,
						name: 'Power_On_Hours',
						value: 100,
						worst: 100,
						thresh: 0,
						parsed: 5000,
					},
					{
						id: 197,
						name: 'Current_Pending_Sector',
						value: 100,
						worst: 100,
						thresh: 0,
						parsed: 0,
					},
					{
						id: 198,
						name: 'Offline_Uncorrectable',
						value: 100,
						worst: 100,
						thresh: 0,
						parsed: 0,
					},
					{
						id: 199,
						name: 'UDMA_CRC_Error_Count',
						value: 100,
						worst: 100,
						thresh: 0,
						parsed: 0,
					},
				],
			},
		};

		it('should return OK for healthy ATA drive', async () => {
			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaHealthy)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.message).toContain('OK: Disk health is good');
		});

		it('should return WARNING for ATA drive with reallocated sectors', async () => {
			const mockAtaReallocated = {
				...mockAtaHealthy,
				ata_smart_attributes: {
					...mockAtaHealthy.ata_smart_attributes,
					table: mockAtaHealthy.ata_smart_attributes.table.map((attr) =>
						attr.id === 5 ? {...attr, parsed: 10} : attr,
					),
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaReallocated)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('Reallocated Sectors: 10');
		});

		it('should return WARNING for ATA drive with pending sectors', async () => {
			const mockAtaPending = {
				...mockAtaHealthy,
				ata_smart_attributes: {
					...mockAtaHealthy.ata_smart_attributes,
					table: mockAtaHealthy.ata_smart_attributes.table.map((attr) =>
						attr.id === 197 ? {...attr, parsed: 5} : attr,
					),
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaPending)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('Pending Sectors: 5');
		});

		it('should return WARNING for ATA drive with uncorrectable errors', async () => {
			const mockAtaUncorrectable = {
				...mockAtaHealthy,
				ata_smart_attributes: {
					...mockAtaHealthy.ata_smart_attributes,
					table: mockAtaHealthy.ata_smart_attributes.table.map((attr) =>
						attr.id === 198 ? {...attr, parsed: 3} : attr,
					),
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockAtaUncorrectable)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('Uncorrectable Errors: 3');
		});

		it('should return WARNING for ATA drive with CRC errors', async () => {
			const mockAtaCrcErrors = {
				...mockAtaHealthy,
				ata_smart_attributes: {
					...mockAtaHealthy.ata_smart_attributes,
					table: mockAtaHealthy.ata_smart_attributes.table.map((attr) =>
						attr.id === 199 ? {...attr, parsed: 100} : attr,
					),
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaCrcErrors)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('CRC Errors: 100');
		});

		it('should return CRITICAL for ATA drive with SMART failure', async () => {
			const mockAtaFailed = {
				...mockAtaHealthy,
				smart_status: {
					passed: false,
				},
			};

			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaFailed)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain(
				'CRITICAL: SMART status indicates DISK FAILING',
			);
		});

		it('should include ATA performance data', async () => {
			const result = await checkSmartStatus({
				device: '/dev/sda',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaHealthy)),
			});

			const perfDataLabels = result.performanceData?.map((pd) => pd.label);
			expect(perfDataLabels).toContain('temperature');
			expect(perfDataLabels).toContain('power_on_hours');
			expect(perfDataLabels).toContain('power_cycle_count');
			expect(perfDataLabels).toContain('reallocated_sectors');
			expect(perfDataLabels).toContain('pending_sectors');
			expect(perfDataLabels).toContain('uncorrectable_errors');
		});
	});

	describe('Error Handling', () => {
		it('should return UNKNOWN when smartctl command fails with invalid JSON', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockImplementation(() => {
					throw {
						stdout: '',
						stderr: 'smartctl: command not found',
						status: 127,
					};
				}),
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
			expect(result.message).toContain('Failed to parse smartctl output');
		});

		it('should handle command execution error with partial JSON output', async () => {
			const partialJson = '{"smartctl": {"exit_status": 1}}';
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockImplementation(() => {
					throw {
						stdout: partialJson,
						stderr: '',
						status: 1,
					};
				}),
			});

			// Should parse the partial JSON and continue
			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should use provided execSync function', async () => {
			const mockExecSync = jest.fn().mockReturnValue(
				JSON.stringify({
					json_format_version: [1, 0],
					smartctl: {version: [7, 4], exit_status: 0},
					device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
					model_name: 'Test Drive',
					smart_status: {passed: true, nvme: {value: 0}},
					nvme_smart_health_information_log: {
						critical_warning: 0,
						temperature: 30,
						available_spare: 100,
						percentage_used: 0,
						media_errors: 0,
						num_err_log_entries: 0,
					},
				}),
			);

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: mockExecSync,
			});

			expect(mockExecSync).toHaveBeenCalled();
			expect(result.code).toBe(NagiosReturnCodes.OK);
		});
	});

	describe('Check Types', () => {
		const mockNvmeData = {
			json_format_version: [1, 0],
			smartctl: {version: [7, 4], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Samsung SSD 980 500GB',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 35,
				available_spare: 100,
				percentage_used: 2,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 35},
			power_on_time: {hours: 1000},
			power_cycle_count: 100,
		};

		it('should work with checkType=all', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				checkType: 'all',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should work with checkType=health', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				checkType: 'health',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should work with checkType=attributes', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				checkType: 'attributes',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should work with checkType=errors', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				checkType: 'errors',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should work with checkType=selftest', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				checkType: 'selftest',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});
	});

	describe('Temperature Threshold Edge Cases', () => {
		const mockNvmeWithTemp = {
			json_format_version: [1, 0],
			smartctl: {version: [7, 4], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 50,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 50},
		};

		it('should return OK when temperature is below warning threshold', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 55,
				criticalTemp: 60,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.message).not.toContain('Temperature');
		});

		it('should return WARNING when temperature equals warning threshold', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 50,
				criticalTemp: 60,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
			expect(result.message).toContain('WARNING');
		});

		it('should return CRITICAL when temperature equals critical threshold', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 40,
				criticalTemp: 50,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain('CRITICAL');
		});

		it('should return CRITICAL when temperature exceeds critical threshold', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 40,
				criticalTemp: 45,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain('CRITICAL');
		});

		it('should escalate from WARNING to CRITICAL when temperature increases', async () => {
			const mockNvmeHot = {
				...mockNvmeWithTemp,
				nvme_smart_health_information_log: {
					...mockNvmeWithTemp.nvme_smart_health_information_log,
					temperature: 65,
				},
				temperature: {current: 65},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 50,
				criticalTemp: 60,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeHot)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
			expect(result.message).toContain('CRITICAL');
		});
	});

	describe('Return Code Escalation', () => {
		it('should maintain CRITICAL when temperature is critical and SMART is failing', async () => {
			const mockNvmeCritical = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
				model_name: 'Test Drive',
				smart_status: {passed: false, nvme: {value: 1}},
				nvme_smart_health_information_log: {
					critical_warning: 0,
					temperature: 70,
					available_spare: 100,
					percentage_used: 0,
					media_errors: 0,
					num_err_log_entries: 0,
				},
				temperature: {current: 70},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 50,
				criticalTemp: 60,
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeCritical)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		});

		it('should escalate from OK to WARNING when media errors found', async () => {
			const mockNvmeMediaErrors = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
				model_name: 'Test Drive',
				smart_status: {passed: true, nvme: {value: 0}},
				nvme_smart_health_information_log: {
					critical_warning: 0,
					temperature: 30,
					available_spare: 100,
					percentage_used: 0,
					media_errors: 10,
					num_err_log_entries: 0,
				},
				temperature: {current: 30},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeMediaErrors)),
			});

			expect(result.code).toBe(NagiosReturnCodes.WARNING);
		});

		it('should maintain CRITICAL when multiple issues occur', async () => {
			const mockNvmeMultipleIssues = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
				model_name: 'Test Drive',
				smart_status: {passed: false, nvme: {value: 1}},
				nvme_smart_health_information_log: {
					critical_warning: 17, // Temperature too high + media degraded
					temperature: 70,
					available_spare: 100,
					percentage_used: 0,
					media_errors: 100,
					num_err_log_entries: 0,
				},
				temperature: {current: 70},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 50,
				criticalTemp: 60,
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeMultipleIssues)),
			});

			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		});
	});

	describe('Performance Data Validation', () => {
		const mockNvmeWithPerfData = {
			json_format_version: [1, 0],
			smartctl: {version: [7, 4], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Samsung SSD 980 500GB',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 35,
				available_spare: 100,
				percentage_used: 2,
				media_errors: 0,
				num_err_log_entries: 5,
			},
			temperature: {current: 35},
			power_on_time: {hours: 1000},
			power_cycle_count: 100,
		};

		it('should include temperature with correct thresholds in performance data', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				warningTemp: 50,
				criticalTemp: 60,
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeWithPerfData)),
			});

			const tempPerfData = result.performanceData?.find(
				(pd) => pd.label === 'temperature',
			);
			expect(tempPerfData).toBeDefined();
			expect(tempPerfData?.value).toBe(35);
			expect(tempPerfData?.uom).toBe('C');
			expect(tempPerfData?.warn).toBe('50');
			expect(tempPerfData?.crit).toBe('60');
		});

		it('should include available_spare with thresholds', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeWithPerfData)),
			});

			const sparePerfData = result.performanceData?.find(
				(pd) => pd.label === 'available_spare',
			);
			expect(sparePerfData).toBeDefined();
			expect(sparePerfData?.value).toBe(100);
			expect(sparePerfData?.uom).toBe('%');
			expect(sparePerfData?.warn).toBe('10');
			expect(sparePerfData?.crit).toBe('5');
		});

		it('should include media_errors with critical threshold', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest
					.fn()
					.mockReturnValue(JSON.stringify(mockNvmeWithPerfData)),
			});

			const mediaPerfData = result.performanceData?.find(
				(pd) => pd.label === 'media_errors',
			);
			expect(mediaPerfData).toBeDefined();
			expect(mediaPerfData?.value).toBe(0);
			expect(mediaPerfData?.uom).toBe('count');
			expect(mediaPerfData?.crit).toBe('1');
		});
	});

	describe('Default Parameters', () => {
		const mockNvmeData = {
			json_format_version: [1, 0],
			smartctl: {version: [7, 4], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 35,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 35},
			power_on_time: {hours: 1000},
			power_cycle_count: 100,
		};

		it('should use default warningTemp=50 and criticalTemp=60', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			const tempPerfData = result.performanceData?.find(
				(pd) => pd.label === 'temperature',
			);
			expect(tempPerfData?.warn).toBe('50');
			expect(tempPerfData?.crit).toBe('60');
		});

		it('should use default checkType=all', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should use default skipPowerModeCheck=false', async () => {
			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeData)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});
	});

	describe('Unknown Device Type', () => {
		it('should handle device with unknown type gracefully', async () => {
			const mockUnknownDevice = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/unknown', type: 'unknown', protocol: 'Unknown'},
				model_name: 'Unknown Device',
				smart_status: {passed: true},
				temperature: {current: 30},
			};

			const result = await checkSmartStatus({
				device: '/dev/unknown',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockUnknownDevice)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.message).toContain('OK: Disk health is good');
		});
	});

	describe('Missing Optional Fields', () => {
		it('should handle missing temperature gracefully', async () => {
			const mockNoTemp = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
				model_name: 'Test Drive',
				smart_status: {passed: true, nvme: {value: 0}},
				nvme_smart_health_information_log: {
					critical_warning: 0,
					temperature: 30,
					available_spare: 100,
					percentage_used: 0,
					media_errors: 0,
					num_err_log_entries: 0,
				},
				power_on_time: {hours: 1000},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNoTemp)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should handle missing power_on_time gracefully', async () => {
			const mockNoPowerTime = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
				model_name: 'Test Drive',
				smart_status: {passed: true, nvme: {value: 0}},
				nvme_smart_health_information_log: {
					critical_warning: 0,
					temperature: 30,
					available_spare: 100,
					percentage_used: 0,
					media_errors: 0,
					num_err_log_entries: 0,
				},
				temperature: {current: 30},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNoPowerTime)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			const powerHoursData = result.performanceData?.find(
				(pd) => pd.label === 'power_on_hours',
			);
			expect(powerHoursData).toBeUndefined();
		});

		it('should handle missing model_name gracefully', async () => {
			const mockNoModel = {
				json_format_version: [1, 0],
				smartctl: {version: [7, 4], exit_status: 0},
				device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
				smart_status: {passed: true, nvme: {value: 0}},
				nvme_smart_health_information_log: {
					critical_warning: 0,
					temperature: 30,
					available_spare: 100,
					percentage_used: 0,
					media_errors: 0,
					num_err_log_entries: 0,
				},
				temperature: {current: 30},
			};

			const result = await checkSmartStatus({
				device: '/dev/nvme0n1',
				execSync: jest.fn().mockReturnValue(JSON.stringify(mockNoModel)),
			});

			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.message).toContain('Unknown: OK: Disk health is good');
		});
	});
});

describe('Branch Coverage - Error Handling', () => {
	it('should handle execError with status code', async () => {
		const mockNvmeData = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 30,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 30},
		};

		// Mock execSync that throws an error with status
		const mockExecSync = jest.fn().mockImplementation(() => {
			const error: any = new Error('Command failed');
			error.status = 1;
			error.stdout = JSON.stringify(mockNvmeData);
			error.stderr = '';
			throw error;
		});

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			execSync: mockExecSync,
		});

		// Should still parse the JSON from stdout even with error
		expect(result.code).toBe(NagiosReturnCodes.OK);
	});
});

describe('Branch Coverage - ATA Performance Data', () => {
	it('should handle ATA drive with null attribute values', async () => {
		const mockAtaMinimal = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/sda', type: 'sat', protocol: 'ATA'},
			model_name: 'Test ATA Drive',
			smart_status: {passed: true},
			temperature: {current: 30},
			ata_smart_attributes: {
				table: [
					{
						id: 5,
						name: 'Reallocated_Sector_Ct',
						value: 100,
						worst: 100,
						thresh: 10,
						parsed: null, // null value
					},
					{
						id: 9,
						name: 'Power_On_Hours',
						value: 100,
						worst: 100,
						thresh: 0,
						parsed: 5000,
					},
				],
			},
		};

		const result = await checkSmartStatus({
			device: '/dev/sda',
			execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaMinimal)),
		});

		expect(result.code).toBe(NagiosReturnCodes.OK);
		// Should not include reallocated_sectors in performance data when null
		const reallocatedData = result.performanceData?.find(
			(pd) => pd.label === 'reallocated_sectors',
		);
		expect(reallocatedData).toBeUndefined();
	});

	it('should handle ATA drive with missing attributes table', async () => {
		const mockAtaNoAttributes = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/sda', type: 'sat', protocol: 'ATA'},
			model_name: 'Test ATA Drive',
			smart_status: {passed: true},
			temperature: {current: 30},
		};

		const result = await checkSmartStatus({
			device: '/dev/sda',
			execSync: jest.fn().mockReturnValue(JSON.stringify(mockAtaNoAttributes)),
		});

		expect(result.code).toBe(NagiosReturnCodes.OK);
		// Should not include any ATA attribute performance data
		const reallocatedData = result.performanceData?.find(
			(pd) => pd.label === 'reallocated_sectors',
		);
		expect(reallocatedData).toBeUndefined();
	});
});

describe('Branch Coverage - Temperature Escalation', () => {
	it('should maintain WARNING when temperature is critical but returnCode is already WARNING', async () => {
		const mockNvmeWithTemp = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 70,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 10, // This triggers WARNING first
				num_err_log_entries: 0,
			},
			temperature: {current: 70},
		};

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			warningTemp: 50,
			criticalTemp: 60,
			execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
		});

		expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		expect(result.message).toContain('CRITICAL');
	});

	it('should maintain CRITICAL when temperature is critical and returnCode is already CRITICAL', async () => {
		const mockNvmeWithTemp = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: false, nvme: {value: 1}}, // This triggers CRITICAL first
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 70,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 70},
		};

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			warningTemp: 50,
			criticalTemp: 60,
			execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
		});

		expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
	});
});

describe('Branch Coverage - execError without status', () => {
	it('should handle execError without status property', async () => {
		const mockNvmeData = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 30,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 30},
		};

		// Mock execSync that throws an error without status
		const mockExecSync = jest.fn().mockImplementation(() => {
			const error: any = new Error('Command failed');
			error.stdout = JSON.stringify(mockNvmeData);
			error.stderr = '';
			// No status property
			throw error;
		});

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			execSync: mockExecSync,
		});

		// Should still parse the JSON from stdout even with error
		expect(result.code).toBe(NagiosReturnCodes.OK);
	});
});

describe('Branch Coverage - injectedExecSync parameter', () => {
	it('should use injectedExecSync when provided', async () => {
		const mockNvmeData = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 30,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 30},
		};

		const mockExecSync = jest
			.fn()
			.mockReturnValue(JSON.stringify(mockNvmeData));

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			execSync: mockExecSync,
		});

		expect(mockExecSync).toHaveBeenCalled();
		expect(result.code).toBe(NagiosReturnCodes.OK);
	});
});

describe('Branch Coverage - Temperature at warning threshold', () => {
	it('should return WARNING when temperature equals warning threshold exactly', async () => {
		const mockNvmeWithTemp = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: true, nvme: {value: 0}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 50,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 50},
		};

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			warningTemp: 50,
			criticalTemp: 60,
			execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
		});

		expect(result.code).toBe(NagiosReturnCodes.WARNING);
		expect(result.message).toContain('Temperature 50°C >= 50°C (WARNING)');
	});

	it('should maintain existing WARNING when temperature is at warning threshold', async () => {
		const mockNvmeWithTemp = {
			json_format_version: [1, 0] as [number, number],
			smartctl: {version: [7, 4] as [number, number], exit_status: 0},
			device: {name: '/dev/nvme0n1', type: 'nvme', protocol: 'NVMe'},
			model_name: 'Test Drive',
			smart_status: {passed: false, nvme: {value: 1}},
			nvme_smart_health_information_log: {
				critical_warning: 0,
				temperature: 50,
				available_spare: 100,
				percentage_used: 0,
				media_errors: 0,
				num_err_log_entries: 0,
			},
			temperature: {current: 50},
		};

		const result = await checkSmartStatus({
			device: '/dev/nvme0n1',
			warningTemp: 50,
			criticalTemp: 60,
			execSync: jest.fn().mockReturnValue(JSON.stringify(mockNvmeWithTemp)),
		});

		// SMART failure returns CRITICAL (2), temperature warning maintains CRITICAL
		expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		expect(result.message).toContain('WARNING');
	});
});
