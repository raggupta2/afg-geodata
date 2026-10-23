-- Replaces the old Aviation Edge airport hub names (often just the city or
-- an old locality, e.g. DED "Dehra Dun", LKO "Amausi", TRZ "Civil") with the
-- airport names from the flight SQLite export
-- (20261017120000_flight_sqlite_source). On 2026-10-23, 133 of 165 airports
-- differed; VTZ is left out on purpose because its export name is the new
-- Bhogapuram airport, while its hub stays at the current airport, so 132
-- names change. Only names that differ are updated, so re-running the
-- statements does nothing. One transaction.
--
-- Backup kept outside the Prisma-managed public schema. Restore with:
--   UPDATE transport_hubs hub SET name = b.name
--   FROM maintenance_backups.airport_hub_names_20261023 b
--   WHERE b.hub_id = hub.id;

BEGIN;

CREATE TEMPORARY TABLE "airport_name_fix" (
    "iata_code" VARCHAR(3) PRIMARY KEY,
    "name" VARCHAR(200) NOT NULL
);

INSERT INTO "airport_name_fix" ("iata_code", "name") VALUES
    ('AGR', 'Agra Airport / Agra Air Force Station'),
    ('AGX', 'Agatti Airport'),
    ('AHA', 'Maa Mahamaya Airport'),
    ('AIP', 'Adampur Airport'),
    ('AJL', 'Lengpui Airport'),
    ('AKD', 'Akola Airport'),
    ('AMD', 'Sardar Vallabh Patel International Airport'),
    ('ATQ', 'Sri Guru Ram Das Ji International Airport'),
    ('AVR', 'Amravati  Airport'),
    ('AYJ', 'Maharshi Valmiki International Airport'),
    ('AZH', 'Azamgarh Airport'),
    ('BBI', 'Biju Patnaik International Airport'),
    ('BDQ', 'Vadodara International Airport'),
    ('BEK', 'Bareilly Air Force Station'),
    ('BEP', 'Bellary Airport'),
    ('BHJ', 'Bhuj Airport'),
    ('BHO', 'Raja Bhoj International Airport'),
    ('BHU', 'Bhavnagar Airport'),
    ('BKB', 'Nal Airport'),
    ('BLR', 'Kempegowda International Airport Bengaluru'),
    ('BOM', 'Chhatrapati Shivaji Maharaj International Airport'),
    ('BPM', 'Begumpet Airport'),
    ('BUP', 'Bhatinda Air Force Station'),
    ('CBD', 'Car Nicobar Air Force Base'),
    ('CCJ', 'Calicut International Airport'),
    ('CCU', 'Netaji Subhash Chandra Bose International Airport'),
    ('CDP', 'Kadapa Airport'),
    ('CJB', 'Coimbatore International Airport'),
    ('CNN', 'Kannur International Airport'),
    ('COH', 'Cooch Behar Airport'),
    ('COK', 'Cochin International Airport'),
    ('CWK', 'Chitrakoot Airport'),
    ('DBD', 'Dhanbad Airport'),
    ('DBR', 'Darbhanga Airport'),
    ('DED', 'Dehradun Jolly Grant Airport'),
    ('DEL', 'Indira Gandhi International Airport'),
    ('DEP', 'Daporijo Airport'),
    ('DGH', 'Deoghar Airport'),
    ('DHM', 'Kangra Airport'),
    ('DIB', 'Dibrugarh Airport'),
    ('DIU', 'Diu Airport'),
    ('DMU', 'Dimapur Airport'),
    ('DXN', 'Noida International Airport'),
    ('GAU', 'Lokpriya Gopinath Bordoloi International Airport'),
    ('GAY', 'Gaya Airport'),
    ('GBI', 'Kalaburagi Airport'),
    ('GDB', 'Gondia Airport'),
    ('GOI', 'Goa Dabolim International Airport'),
    ('GOP', 'Gorakhpur Airport'),
    ('GOX', 'Manohar International Airport'),
    ('GUX', 'Guna Airport'),
    ('GWL', 'Gwalior Airport'),
    ('HBX', 'Hubballi Airport'),
    ('HDO', 'Hindon Airport / Hindon Air Force Station'),
    ('HDX', 'Delhi Hindon Airport'),
    ('HGI', 'Itanagar Donyi Polo Hollongi Airport'),
    ('HJR', 'Khajuraho Airport'),
    ('HRH', 'Aligarh Airport'),
    ('HSR', 'Rajkot International Airport'),
    ('HSS', 'Maharaja Agrasen International Airport'),
    ('HWR', 'Halwara International Airport'),
    ('HYD', 'Rajiv Gandhi International Airport'),
    ('IDR', 'Devi Ahilya Bai Holkar International Airport'),
    ('IMF', 'Bir Tikendrajit International Airport'),
    ('ISK', 'Nashik International Airport'),
    ('IXA', 'Agartala - Maharaja Bir Bikram Airport'),
    ('IXB', 'Bagdogra Airport'),
    ('IXC', 'Shaheed Bhagat Singh International Airport'),
    ('IXD', 'Prayagraj Airport'),
    ('IXE', 'Mangaluru International Airport'),
    ('IXG', 'Belagavi Airport'),
    ('IXH', 'Kailashahar Airport'),
    ('IXI', 'Lilabari North Lakhimpur Airport'),
    ('IXJ', 'Jammu Airport'),
    ('IXK', 'Keshod Airport'),
    ('IXL', 'Leh Kushok Bakula Rimpochee Airport'),
    ('IXM', 'Madurai Airport'),
    ('IXN', 'Khowai Airport'),
    ('IXP', 'Pathankot Airport'),
    ('IXQ', 'Kamalpur Airport'),
    ('IXR', 'Birsa Munda Airport'),
    ('IXS', 'Silchar Airport'),
    ('IXT', 'Pasighat Airport'),
    ('IXU', 'Aurangabad Airport'),
    ('IXV', 'Along Airport'),
    ('IXW', 'Sonari Airport'),
    ('IXX', 'Bidar Airport / Bidar Air Force Station'),
    ('IXY', 'Kandla Airport'),
    ('IXZ', 'Veer Savarkar International Airport / INS Utkrosh'),
    ('JAI', 'Jaipur International Airport'),
    ('JDH', 'Jodhpur Airport'),
    ('JGA', 'Jamnagar Airport'),
    ('JGB', 'Jagdalpur Airport'),
    ('JLG', 'Jalgaon Airport'),
    ('JLR', 'Jabalpur Airport'),
    ('JRG', 'Jharsuguda Airport'),
    ('JRH', 'Jorhat Airport'),
    ('JSA', 'Jaisalmer Airport'),
    ('KBK', 'Kushinagar International Airport'),
    ('KJB', 'Kurnool Airport'),
    ('KLH', 'Kolhapur Airport'),
    ('KNU', 'Kanpur Airport'),
    ('KQH', 'Kishangarh Airport Ajmer'),
    ('KTU', 'Kota Airport'),
    ('KUU', 'Kullu Manali Airport'),
    ('LDA', 'Malda Airport'),
    ('LKO', 'Chaudhary Charan Singh International Airport'),
    ('LTU', 'Murod Kond Airport'),
    ('LUH', 'Ludhiana Airport'),
    ('MAA', 'Chennai International Airport'),
    ('MYQ', 'Mysore Airport'),
    ('MZS', 'Moradabad Airport'),
    ('MZU', 'Muzaffarpur Airport'),
    ('NAG', 'Dr. Babasaheb Ambedkar International Airport'),
    ('NDC', 'Nanded Airport'),
    ('NMB', 'Daman Airport'),
    ('NMI', 'Navi Mumbai International Airport'),
    ('NVY', 'Neyveli Airport'),
    ('PAB', 'Bilaspur Airport'),
    ('PAT', 'Jay Prakash Narayan Airport'),
    ('PBD', 'Porbandar Airport'),
    ('PGH', 'Pantnagar Airport'),
    ('PNQ', 'Pune International Airport'),
    ('PNY', 'Pondicherry Airport'),
    ('PUT', 'Sri Sathya Sai Airport'),
    ('PYB', 'Jeypore Airport'),
    ('PYG', 'Pakyong Airport'),
    ('RAJ', 'Rajkot Airport'),
    ('RDP', 'Kazi Nazrul Islam Airport'),
    ('REW', 'Rewa Airport, Chorhata, REWA'),
    ('RGH', 'Balurghat Airport'),
    ('RJA', 'Rajahmundry Airport'),
    ('RJI', 'Rajouri Airport'),
    ('RMD', 'Basanth Nagar Airport'),
    ('RPR', 'Swami Vivekananda Airport'),
    ('RQY', 'Rashtrakavi Kuvempu Airport'),
    ('RRK', 'Rourkela Airport'),
    ('RTC', 'Ratnagiri Airport'),
    ('RUP', 'Rupsi Airport'),
    ('SAG', 'Shirdi International Airport'),
    ('SDW', 'Sindhudurg Airport'),
    ('SHL', 'Shillong Airport'),
    ('SLV', 'Shimla Airport'),
    ('SSE', 'Solapur Airport'),
    ('STV', 'Surat International Airport'),
    ('SWN', 'Sarsawa Air Force Station'),
    ('SXR', 'Srinagar International Airport'),
    ('SXV', 'Salem Airport'),
    ('TCR', 'Tuticorin Airport'),
    ('TEI', 'Tezu Airport'),
    ('TEZ', 'Tezpur Airport'),
    ('TIR', 'Tirupati International Airport'),
    ('TJV', 'Thanjavur Air Force Station'),
    ('TNI', 'Satna Airport'),
    ('TRV', 'Thiruvananthapuram International Airport'),
    ('TRZ', 'Tiruchirappalli International Airport'),
    ('UDR', 'Maharana Pratap Airport'),
    ('UKE', 'Utkela Airport'),
    ('VDY', 'Jindal Vijaynagar Airport'),
    ('VGA', 'Vijayawada International Airport'),
    ('VNS', 'Lal Bahadur Shastri International Airport'),
    ('VSV', 'Shravasti Airport'),
    ('WGC', 'Warangal Airport'),
    ('ZER', 'Ziro Airport');

CREATE TEMPORARY TABLE "airport_name_targets" AS
SELECT hub."id" AS "hub_id", fix."name"
FROM "airport_name_fix" fix
JOIN "aviation_airports" airport ON airport."iata_code" = fix."iata_code"
JOIN "transport_hubs" hub ON hub."id" = airport."hub_id"
WHERE hub."name" IS DISTINCT FROM fix."name";

CREATE SCHEMA IF NOT EXISTS "maintenance_backups";

CREATE TABLE IF NOT EXISTS "maintenance_backups"."airport_hub_names_20261023" (
    "hub_id" BIGINT PRIMARY KEY,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "maintenance_backups"."airport_hub_names_20261023" ("hub_id", "code", "name")
SELECT hub."id", hub."code", hub."name"
FROM "transport_hubs" hub
JOIN "airport_name_targets" target ON target."hub_id" = hub."id"
ON CONFLICT ("hub_id") DO NOTHING;

UPDATE "transport_hubs" hub
SET "name" = target."name",
    "updated_at" = CURRENT_TIMESTAMP
FROM "airport_name_targets" target
WHERE target."hub_id" = hub."id";

DROP TABLE "airport_name_targets";
DROP TABLE "airport_name_fix";

COMMIT;
