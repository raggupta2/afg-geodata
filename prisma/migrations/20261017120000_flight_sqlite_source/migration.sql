-- Flight data now comes from the project's own SQLite flight exports
-- (imported by src/maintenance/import-flight-sqlite.ts) instead of Aviation
-- Edge files. Existing Aviation Edge rows are kept and tagged by data_source.

ALTER TABLE "aviation_airports"
    ALTER COLUMN "provider_airport_id" DROP NOT NULL,
    ADD COLUMN "data_source" VARCHAR(30) NOT NULL DEFAULT 'AVIATION_EDGE';
ALTER TABLE "aviation_airports" ALTER COLUMN "data_source" SET DEFAULT 'FLIGHT_SQLITE';

ALTER TABLE "aviation_airlines"
    ALTER COLUMN "provider_airline_id" DROP NOT NULL,
    ADD COLUMN "data_source" VARCHAR(30) NOT NULL DEFAULT 'AVIATION_EDGE';
ALTER TABLE "aviation_airlines" ALTER COLUMN "data_source" SET DEFAULT 'FLIGHT_SQLITE';

ALTER TABLE "aviation_flight_instances"
    ADD COLUMN "data_source" VARCHAR(30) NOT NULL DEFAULT 'AVIATION_EDGE',
    ADD COLUMN "source_provider" VARCHAR(50),
    ADD COLUMN "source_record_id" VARCHAR(100),
    ADD COLUMN "last_seen_at" TIMESTAMP(3);
ALTER TABLE "aviation_flight_instances" ALTER COLUMN "data_source" SET DEFAULT 'FLIGHT_SQLITE';

ALTER TABLE "aviation_schedule_imports"
    ADD COLUMN "data_source" VARCHAR(30) NOT NULL DEFAULT 'AVIATION_EDGE';
ALTER TABLE "aviation_schedule_imports" ALTER COLUMN "data_source" SET DEFAULT 'FLIGHT_SQLITE';

-- Supports deactivating flights on a re-collected route and service date.
CREATE INDEX "aviation_flights_route_service_date_idx"
    ON "aviation_flight_instances" ("departure_airport_id", "arrival_airport_id", "service_date");

-- Fare observations collected with each flight. Not read by search yet; kept
-- for future flight pricing.
CREATE TABLE "aviation_flight_fares" (
    "id" BIGSERIAL PRIMARY KEY,
    "flight_instance_id" BIGINT NOT NULL,
    "source_fare_key" CHAR(64) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "fare_family" VARCHAR(100),
    "cabin_class" VARCHAR(30),
    "base_fare" DECIMAL(12, 2),
    "taxes" DECIMAL(12, 2),
    "fees" DECIMAL(12, 2),
    "total_price" DECIMAL(12, 2),
    "currency" CHAR(3),
    "passenger_count" INTEGER,
    "baggage_details" TEXT,
    "cabin_baggage" TEXT,
    "refundability" TEXT,
    "change_cancel_conditions" TEXT,
    "fare_rules" TEXT,
    "booking_url" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aviation_flight_fares_flight_instance_id_fkey" FOREIGN KEY ("flight_instance_id")
        REFERENCES "aviation_flight_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "aviation_flight_fares_prices_check" CHECK (
        ("base_fare" IS NULL OR "base_fare" >= 0)
        AND ("taxes" IS NULL OR "taxes" >= 0)
        AND ("fees" IS NULL OR "fees" >= 0)
        AND ("total_price" IS NULL OR "total_price" >= 0)
    )
);
CREATE UNIQUE INDEX "aviation_flight_fares_source_fare_key_key" ON "aviation_flight_fares"("source_fare_key");
CREATE INDEX "aviation_flight_fares_flight_collected_idx" ON "aviation_flight_fares"("flight_instance_id", "collected_at");

-- Airports from the flight SQLite export (flights-2026-10-17T07-19-09-882Z).
-- Airports that already exist keep their current hub, coordinates and city;
-- only missing airports are added. The importer links new airport hubs to the
-- nearest city and to nearby railway stations.
WITH "source_airports" ("iata_code", "name", "latitude", "longitude", "timezone") AS (
    VALUES
        ('AGR', 'Agra Airport / Agra Air Force Station', 27.1579750, 77.9610250, 'Asia/Kolkata'),
        ('AGX', 'Agatti Airport', 10.8237000, 72.1760030, 'Asia/Kolkata'),
        ('AHA', 'Maa Mahamaya Airport', 22.9875300, 83.1961200, 'Asia/Kolkata'),
        ('AIP', 'Adampur Airport', 31.4338000, 75.7587970, 'Asia/Kolkata'),
        ('AJL', 'Lengpui Airport', 23.8405990, 92.6196980, 'Asia/Kolkata'),
        ('AKD', 'Akola Airport', 20.6989310, 77.0568830, 'Asia/Kolkata'),
        ('AMD', 'Sardar Vallabh Patel International Airport', 23.0772000, 72.6346970, 'Asia/Kolkata'),
        ('ATQ', 'Sri Guru Ram Das Ji International Airport', 31.7096000, 74.7973020, 'Asia/Kolkata'),
        ('AVR', 'Amravati  Airport', 20.8146080, 77.7177650, 'Asia/Kolkata'),
        ('AYJ', 'Maharshi Valmiki International Airport', 26.7477360, 82.1636640, 'Asia/Kolkata'),
        ('AZH', 'Azamgarh Airport', 26.1533330, 83.1183330, 'Asia/Kolkata'),
        ('BBI', 'Biju Patnaik International Airport', 20.2510210, 85.8147470, 'Asia/Kolkata'),
        ('BDQ', 'Vadodara International Airport', 22.3362010, 73.2263030, 'Asia/Kolkata'),
        ('BEK', 'Bareilly Air Force Station', 28.4221000, 79.4507980, 'Asia/Kolkata'),
        ('BEP', 'Bellary Airport', 15.1628000, 76.8827970, 'Asia/Kolkata'),
        ('BHJ', 'Bhuj Airport', 23.2878000, 69.6701970, 'Asia/Kolkata'),
        ('BHO', 'Raja Bhoj International Airport', 23.2875000, 77.3374020, 'Asia/Kolkata'),
        ('BHU', 'Bhavnagar Airport', 21.7521990, 72.1852040, 'Asia/Kolkata'),
        ('BKB', 'Nal Airport', 28.0706010, 73.2071990, 'Asia/Kolkata'),
        ('BLR', 'Kempegowda International Airport Bengaluru', 13.1979000, 77.7062990, 'Asia/Kolkata'),
        ('BOM', 'Chhatrapati Shivaji Maharaj International Airport', 19.0886990, 72.8678970, 'Asia/Kolkata'),
        ('BPM', 'Begumpet Airport', 17.4531000, 78.4675980, 'Asia/Kolkata'),
        ('BUP', 'Bhatinda Air Force Station', 30.2701000, 74.7557980, 'Asia/Kolkata'),
        ('CBD', 'Car Nicobar Air Force Base', 9.1530560, 92.8192730, 'Asia/Kolkata'),
        ('CCJ', 'Calicut International Airport', 11.1359960, 75.9551520, 'Asia/Kolkata'),
        ('CCU', 'Netaji Subhash Chandra Bose International Airport', 22.6540120, 88.4476500, 'Asia/Kolkata'),
        ('CDP', 'Kadapa Airport', 14.5131540, 78.7691830, 'Asia/Kolkata'),
        ('CJB', 'Coimbatore International Airport', 11.0300000, 77.0434040, 'Asia/Kolkata'),
        ('CNN', 'Kannur International Airport', 11.9163430, 75.5449790, 'Asia/Kolkata'),
        ('COH', 'Cooch Behar Airport', 26.3305000, 89.4672010, 'Asia/Kolkata'),
        ('COK', 'Cochin International Airport', 10.1510470, 76.4008380, 'Asia/Kolkata'),
        ('CWK', 'Chitrakoot Airport', 25.1676940, 80.9358000, 'Asia/Kolkata'),
        ('DBD', 'Dhanbad Airport', 23.8340000, 86.4253010, 'Asia/Kolkata'),
        ('DBR', 'Darbhanga Airport', 26.1928010, 85.9169010, 'Asia/Kolkata'),
        ('DED', 'Dehradun Jolly Grant Airport', 30.1892430, 78.1766510, 'Asia/Kolkata'),
        ('DEL', 'Indira Gandhi International Airport', 28.5556300, 77.0951900, 'Asia/Kolkata'),
        ('DEP', 'Daporijo Airport', 27.9855000, 94.2228010, 'Asia/Kolkata'),
        ('DGH', 'Deoghar Airport', 24.4468420, 86.7049550, 'Asia/Kolkata'),
        ('DHM', 'Kangra Airport', 32.1649020, 76.2630180, 'Asia/Kolkata'),
        ('DIB', 'Dibrugarh Airport', 27.4839000, 95.0168990, 'Asia/Kolkata'),
        ('DIU', 'Diu Airport', 20.7141850, 70.9218550, 'Asia/Kolkata'),
        ('DMU', 'Dimapur Airport', 25.8839000, 93.7711030, 'Asia/Kolkata'),
        ('DXN', 'Noida International Airport', 28.1798680, 77.6118430, 'Asia/Kolkata'),
        ('GAU', 'Lokpriya Gopinath Bordoloi International Airport', 26.1066540, 91.5852260, 'Asia/Kolkata'),
        ('GAY', 'Gaya Airport', 24.7443010, 84.9512020, 'Asia/Kolkata'),
        ('GBI', 'Kalaburagi Airport', 17.3081540, 76.9652460, 'Asia/Kolkata'),
        ('GDB', 'Gondia Airport', 21.5268170, 80.2903470, 'Asia/Kolkata'),
        ('GOI', 'Goa Dabolim International Airport', 15.3800620, 73.8333280, 'Asia/Kolkata'),
        ('GOP', 'Gorakhpur Airport', 26.7397000, 83.4496990, 'Asia/Kolkata'),
        ('GOX', 'Manohar International Airport', 15.7442570, 73.8606250, 'Asia/Kolkata'),
        ('GUX', 'Guna Airport', 24.6546990, 77.3472980, 'Asia/Kolkata'),
        ('GWL', 'Gwalior Airport', 26.2933010, 78.2277980, 'Asia/Kolkata'),
        ('HBX', 'Hubballi Airport', 15.3610840, 75.0820960, 'Asia/Kolkata'),
        ('HDO', 'Hindon Airport / Hindon Air Force Station', 28.7077010, 77.3589020, 'Asia/Kolkata'),
        ('HDX', 'Delhi Hindon Airport', 28.7057900, 77.3421370, 'Asia/Kolkata'),
        ('HGI', 'Itanagar Donyi Polo Hollongi Airport', 26.9668300, 93.6387920, 'Asia/Kolkata'),
        ('HJR', 'Khajuraho Airport', 24.8172000, 79.9186020, 'Asia/Kolkata'),
        ('HRH', 'Aligarh Airport', 27.8614370, 78.1454040, 'Asia/Kolkata'),
        ('HSR', 'Rajkot International Airport', 22.3788240, 71.0393910, 'Asia/Kolkata'),
        ('HSS', 'Maharaja Agrasen International Airport', 29.1860650, 75.7414200, 'Asia/Kolkata'),
        ('HWR', 'Halwara International Airport', 30.7485010, 75.6297990, 'Asia/Kolkata'),
        ('HYD', 'Rajiv Gandhi International Airport', 17.2313180, 78.4298550, 'Asia/Kolkata'),
        ('IDR', 'Devi Ahilya Bai Holkar International Airport', 22.7214040, 75.8005100, 'Asia/Kolkata'),
        ('IMF', 'Bir Tikendrajit International Airport', 24.7600000, 93.8966980, 'Asia/Kolkata'),
        ('ISK', 'Nashik International Airport', 20.1191010, 73.9129030, 'Asia/Kolkata'),
        ('IXA', 'Agartala - Maharaja Bir Bikram Airport', 23.8869990, 91.2404020, 'Asia/Kolkata'),
        ('IXB', 'Bagdogra Airport', 26.6812000, 88.3285980, 'Asia/Kolkata'),
        ('IXC', 'Shaheed Bhagat Singh International Airport', 30.6735000, 76.7884980, 'Asia/Kolkata'),
        ('IXD', 'Prayagraj Airport', 25.4401000, 81.7339020, 'Asia/Kolkata'),
        ('IXE', 'Mangaluru International Airport', 12.9547100, 74.8868120, 'Asia/Kolkata'),
        ('IXG', 'Belagavi Airport', 15.8593000, 74.6183010, 'Asia/Kolkata'),
        ('IXH', 'Kailashahar Airport', 24.3086570, 92.0076800, 'Asia/Kolkata'),
        ('IXI', 'Lilabari North Lakhimpur Airport', 27.2956820, 94.0972660, 'Asia/Kolkata'),
        ('IXJ', 'Jammu Airport', 32.6888490, 74.8381520, 'Asia/Kolkata'),
        ('IXK', 'Keshod Airport', 21.3171010, 70.2704010, 'Asia/Kolkata'),
        ('IXL', 'Leh Kushok Bakula Rimpochee Airport', 34.1358990, 77.5465010, 'Asia/Kolkata'),
        ('IXM', 'Madurai Airport', 9.8345100, 78.0933990, 'Asia/Kolkata'),
        ('IXN', 'Khowai Airport', 24.0618990, 91.6038970, 'Asia/Kolkata'),
        ('IXP', 'Pathankot Airport', 32.2336110, 75.6344440, 'Asia/Kolkata'),
        ('IXQ', 'Kamalpur Airport', 24.1343250, 91.8107690, 'Asia/Kolkata'),
        ('IXR', 'Birsa Munda Airport', 23.3143010, 85.3217010, 'Asia/Kolkata'),
        ('IXS', 'Silchar Airport', 24.9129010, 92.9786990, 'Asia/Kolkata'),
        ('IXT', 'Pasighat Airport', 28.0647860, 95.3369520, 'Asia/Kolkata'),
        ('IXU', 'Aurangabad Airport', 19.8628750, 75.3963120, 'Asia/Kolkata'),
        ('IXV', 'Along Airport', 28.1753010, 94.8020020, 'Asia/Kolkata'),
        ('IXW', 'Sonari Airport', 22.8137060, 86.1689810, 'Asia/Kolkata'),
        ('IXX', 'Bidar Airport / Bidar Air Force Station', 17.9081000, 77.4870990, 'Asia/Kolkata'),
        ('IXY', 'Kandla Airport', 23.1127000, 70.1003040, 'Asia/Kolkata'),
        ('IXZ', 'Veer Savarkar International Airport / INS Utkrosh', 11.6401940, 92.7290200, 'Asia/Kolkata'),
        ('JAI', 'Jaipur International Airport', 26.8242000, 75.8122020, 'Asia/Kolkata'),
        ('JDH', 'Jodhpur Airport', 26.2511010, 73.0488970, 'Asia/Kolkata'),
        ('JGA', 'Jamnagar Airport', 22.4655000, 70.0126040, 'Asia/Kolkata'),
        ('JGB', 'Jagdalpur Airport', 19.0743010, 82.0367970, 'Asia/Kolkata'),
        ('JLG', 'Jalgaon Airport', 20.9626780, 75.6274920, 'Asia/Kolkata'),
        ('JLR', 'Jabalpur Airport', 23.1777990, 80.0520020, 'Asia/Kolkata'),
        ('JRG', 'Jharsuguda Airport', 21.9135000, 84.0504000, 'Asia/Kolkata'),
        ('JRH', 'Jorhat Airport', 26.7304560, 94.1754160, 'Asia/Kolkata'),
        ('JSA', 'Jaisalmer Airport', 26.8887000, 70.8649980, 'Asia/Kolkata'),
        ('KBK', 'Kushinagar International Airport', 26.7765340, 83.8892140, 'Asia/Kolkata'),
        ('KJB', 'Kurnool Airport', 15.7162880, 78.1692300, 'Asia/Kolkata'),
        ('KLH', 'Kolhapur Airport', 16.6647000, 74.2893980, 'Asia/Kolkata'),
        ('KNU', 'Kanpur Airport', 26.4043010, 80.4101030, 'Asia/Kolkata'),
        ('KQH', 'Kishangarh Airport Ajmer', 26.5910070, 74.8129560, 'Asia/Kolkata'),
        ('KTU', 'Kota Airport', 25.1602000, 75.8455960, 'Asia/Kolkata'),
        ('KUU', 'Kullu Manali Airport', 31.8766990, 77.1544040, 'Asia/Kolkata'),
        ('LDA', 'Malda Airport', 25.0101800, 88.1269170, 'Asia/Kolkata'),
        ('LKO', 'Chaudhary Charan Singh International Airport', 26.7605990, 80.8892970, 'Asia/Kolkata'),
        ('LTU', 'Murod Kond Airport', 18.4115010, 76.4646990, 'Asia/Kolkata'),
        ('LUH', 'Ludhiana Airport', 30.8547000, 75.9525990, 'Asia/Kolkata'),
        ('MAA', 'Chennai International Airport', 12.9900050, 80.1692960, 'Asia/Kolkata'),
        ('MYQ', 'Mysore Airport', 12.2297510, 76.6536830, 'Asia/Kolkata'),
        ('MZS', 'Moradabad Airport', 28.8174600, 78.9218700, 'Asia/Kolkata'),
        ('MZU', 'Muzaffarpur Airport', 26.1191010, 85.3136980, 'Asia/Kolkata'),
        ('NAG', 'Dr. Babasaheb Ambedkar International Airport', 21.0921990, 79.0472030, 'Asia/Kolkata'),
        ('NDC', 'Nanded Airport', 19.1833000, 77.3167040, 'Asia/Kolkata'),
        ('NMB', 'Daman Airport', 20.4344010, 72.8432010, 'Asia/Kolkata'),
        ('NMI', 'Navi Mumbai International Airport', 18.9845970, 73.0652530, 'Asia/Kolkata'),
        ('NVY', 'Neyveli Airport', 11.6129560, 79.5273820, 'Asia/Kolkata'),
        ('PAB', 'Bilaspur Airport', 21.9884000, 82.1110000, 'Asia/Kolkata'),
        ('PAT', 'Jay Prakash Narayan Airport', 25.5912990, 85.0879970, 'Asia/Kolkata'),
        ('PBD', 'Porbandar Airport', 21.6495240, 69.6564050, 'Asia/Kolkata'),
        ('PGH', 'Pantnagar Airport', 29.0334000, 79.4737010, 'Asia/Kolkata'),
        ('PNQ', 'Pune International Airport', 18.5821000, 73.9197010, 'Asia/Kolkata'),
        ('PNY', 'Pondicherry Airport', 11.9680000, 79.8120000, 'Asia/Kolkata'),
        ('PUT', 'Sri Sathya Sai Airport', 14.1493000, 77.7911000, 'Asia/Kolkata'),
        ('PYB', 'Jeypore Airport', 18.8795490, 82.5524780, 'Asia/Kolkata'),
        ('PYG', 'Pakyong Airport', 27.2313000, 88.5871960, 'Asia/Kolkata'),
        ('RAJ', 'Rajkot Airport', 22.3092000, 70.7795030, 'Asia/Kolkata'),
        ('RDP', 'Kazi Nazrul Islam Airport', 23.6225000, 87.2430000, 'Asia/Kolkata'),
        ('REW', 'Rewa Airport, Chorhata, REWA', 24.5034010, 81.2202990, 'Asia/Kolkata'),
        ('RGH', 'Balurghat Airport', 25.2617000, 88.7956010, 'Asia/Kolkata'),
        ('RJA', 'Rajahmundry Airport', 17.1057990, 81.8132040, 'Asia/Kolkata'),
        ('RJI', 'Rajouri Airport', 33.3778990, 74.3152010, 'Asia/Kolkata'),
        ('RMD', 'Basanth Nagar Airport', 18.7010000, 79.3923000, 'Asia/Kolkata'),
        ('RPR', 'Swami Vivekananda Airport', 21.1804010, 81.7388000, 'Asia/Kolkata'),
        ('RQY', 'Rashtrakavi Kuvempu Airport', 13.8580240, 75.6188680, 'Asia/Kolkata'),
        ('RRK', 'Rourkela Airport', 22.2565710, 84.8151930, 'Asia/Kolkata'),
        ('RTC', 'Ratnagiri Airport', 17.0135990, 73.3277970, 'Asia/Kolkata'),
        ('RUP', 'Rupsi Airport', 26.1418670, 89.9078920, 'Asia/Kolkata'),
        ('SAG', 'Shirdi International Airport', 19.6892110, 74.3736550, 'Asia/Kolkata'),
        ('SDW', 'Sindhudurg Airport', 16.0025520, 73.5298460, 'Asia/Kolkata'),
        ('SHL', 'Shillong Airport', 25.7036000, 91.9786990, 'Asia/Kolkata'),
        ('SLV', 'Shimla Airport', 31.0818000, 77.0680010, 'Asia/Kolkata'),
        ('SSE', 'Solapur Airport', 17.6280000, 75.9347990, 'Asia/Kolkata'),
        ('STV', 'Surat International Airport', 21.1155310, 72.7432510, 'Asia/Kolkata'),
        ('SWN', 'Sarsawa Air Force Station', 29.9943030, 77.4245600, 'Asia/Kolkata'),
        ('SXR', 'Srinagar International Airport', 33.9870990, 74.7742000, 'Asia/Kolkata'),
        ('SXV', 'Salem Airport', 11.7833000, 78.0655980, 'Asia/Kolkata'),
        ('TCR', 'Tuticorin Airport', 8.7242410, 78.0258030, 'Asia/Kolkata'),
        ('TEI', 'Tezu Airport', 27.9412000, 96.1343990, 'Asia/Kolkata'),
        ('TEZ', 'Tezpur Airport', 26.7091010, 92.7846980, 'Asia/Kolkata'),
        ('TIR', 'Tirupati International Airport', 13.6319880, 79.5398690, 'Asia/Kolkata'),
        ('TJV', 'Thanjavur Air Force Station', 10.7238350, 79.1094570, 'Asia/Kolkata'),
        ('TNI', 'Satna Airport', 24.5626200, 80.8529270, 'Asia/Kolkata'),
        ('TRV', 'Thiruvananthapuram International Airport', 8.4818890, 76.9200290, 'Asia/Kolkata'),
        ('TRZ', 'Tiruchirappalli International Airport', 10.7629150, 78.7177410, 'Asia/Kolkata'),
        ('UDR', 'Maharana Pratap Airport', 24.6177010, 73.8961030, 'Asia/Kolkata'),
        ('UKE', 'Utkela Airport', 20.0977780, 83.1833330, 'Asia/Kolkata'),
        ('VDY', 'Jindal Vijaynagar Airport', 15.1759210, 76.6330300, 'Asia/Kolkata'),
        ('VGA', 'Vijayawada International Airport', 16.5300110, 80.8048880, 'Asia/Kolkata'),
        ('VNS', 'Lal Bahadur Shastri International Airport', 25.4521710, 82.8625490, 'Asia/Kolkata'),
        ('VSV', 'Shravasti Airport', 27.4997320, 82.0329270, 'Asia/Kolkata'),
        ('VTZ', 'Alluri Sitarama Raju International Airport (Vizag)', 17.9715120, 83.5036170, 'Asia/Kolkata'),
        ('WGC', 'Warangal Airport', 17.9144000, 79.6022030, 'Asia/Kolkata'),
        ('ZER', 'Ziro Airport', 27.5883010, 93.8281020, 'Asia/Kolkata')
),
"missing_airports" AS (
    SELECT source.*
    FROM "source_airports" source
    WHERE NOT EXISTS (
        SELECT 1 FROM "aviation_airports" airport WHERE airport."iata_code" = source."iata_code"
    )
),
"airport_hubs" AS (
    INSERT INTO "transport_hubs" ("hub_type", "code", "name", "latitude", "longitude", "timezone", "geom", "updated_at")
    SELECT
        'AIRPORT',
        missing."iata_code",
        missing."name",
        missing."latitude",
        missing."longitude",
        missing."timezone",
        ST_SetSRID(ST_MakePoint(missing."longitude", missing."latitude"), 4326)::geography,
        CURRENT_TIMESTAMP
    FROM "missing_airports" missing
    ON CONFLICT ("hub_type", "code") DO UPDATE SET "code" = EXCLUDED."code"
    RETURNING "id", "code"
)
INSERT INTO "aviation_airports" ("hub_id", "iata_code", "country_code", "data_source", "updated_at")
SELECT hub."id", hub."code", 'IN', 'FLIGHT_SQLITE', CURRENT_TIMESTAMP
FROM "airport_hubs" hub
ON CONFLICT ("iata_code") DO NOTHING;
