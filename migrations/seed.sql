-- =============================================================================
-- X-Rechnung — optional development seed data.
-- Run manually:  npm run seed:local
-- NOT part of the numbered migration sequence, so it never runs in production
-- automatically. Populates the default service templates (Leistungsvorlagen)
-- and one sample customer (KD-0001 / Muster GmbH).
-- =============================================================================

INSERT OR IGNORE INTO service_templates (id, name, default_description, unit, default_price_cents, category, sort_order) VALUES
 ('tpl_konzeption','Konzeption und Projektvorbereitung','Konzeption und Projektvorbereitung','Pauschale',20000,'Vorbereitung',10),
 ('tpl_drehbuch','Drehbuchentwicklung','Drehbuchentwicklung','Pauschale',30000,'Vorbereitung',20),
 ('tpl_dreh','Videodreh vor Ort','Videodreh vor Ort','Stunde',10000,'Produktion',30),
 ('tpl_kamera','Kameraführung','Kameraführung','Stunde',9000,'Produktion',40),
 ('tpl_kameratechnik','Kamera- und Lichttechnik','Kamera- und Lichttechnik','Tag',40000,'Produktion',50),
 ('tpl_ton','Tonaufnahme','Tonaufnahme','Stunde',8000,'Produktion',60),
 ('tpl_schnitt','Videoschnitt','Videoschnitt','Stunde',7500,'Postproduktion',70),
 ('tpl_post','Postproduktion','Postproduktion','Pauschale',30000,'Postproduktion',80),
 ('tpl_grading','Farbkorrektur und Color Grading','Farbkorrektur und Color Grading','Stunde',9000,'Postproduktion',90),
 ('tpl_sound','Tonbearbeitung und Sounddesign','Tonbearbeitung und Sounddesign','Stunde',8500,'Postproduktion',100),
 ('tpl_motion','Motion Design und Animation','Motion Design und Animation','Stunde',9500,'Postproduktion',110),
 ('tpl_untertitel','Untertitelung','Untertitelung','Pauschale',12000,'Postproduktion',120),
 ('tpl_export','Datenexport und Mastering','Datenexport und Mastering','Pauschale',8000,'Postproduktion',130),
 ('tpl_fahrt','Fahrtkosten','Fahrtkosten','Kilometer',50,'Nebenkosten',140),
 ('tpl_uebernachtung','Übernachtungskosten','Übernachtungskosten','Pauschale',9000,'Nebenkosten',150),
 ('tpl_equipment','Equipmentmiete','Equipmentmiete','Tag',15000,'Nebenkosten',160),
 ('tpl_korrektur','Zusätzliche Korrekturrunde','Zusätzliche Korrekturrunde','Pauschale',7500,'Postproduktion',170),
 ('tpl_recht_web','Nutzungsrechte für Website','Einräumung einfacher Nutzungsrechte für die Veröffentlichung auf der Unternehmenswebsite.','Pauschale',15000,'Nutzungsrechte',180),
 ('tpl_recht_social','Nutzungsrechte für Social Media','Einräumung einfacher Nutzungsrechte für die eigenen Social-Media-Kanäle.','Pauschale',15000,'Nutzungsrechte',190),
 ('tpl_recht_exkl','Ausschließliche Nutzungsrechte','Einräumung ausschließlicher Nutzungsrechte, zeitlich und räumlich unbegrenzt.','Pauschale',50000,'Nutzungsrechte',200);

INSERT OR IGNORE INTO customers
 (id, customer_code, customer_type, company_name, contact_person, first_name, last_name,
  street, postal_code, city, country, email)
VALUES
 ('cust_muster','KD-0001','BUSINESS','Muster GmbH','Erika Muster','Erika','Muster',
  'Musterstraße 10','10115','Berlin','DE','buchhaltung@muster.example');
