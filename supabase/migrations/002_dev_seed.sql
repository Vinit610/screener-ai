-- Seed data for development environment
-- Run only in dev Supabase project, never production

-- Insert 10 stocks with mix of sectors: IT, Banking, FMCG, Pharma, Auto
INSERT INTO stocks (symbol, exchange, name, sector, industry, market_cap_cr, nse_listed, is_active) VALUES
('INFY', 'NSE', 'Infosys Limited', 'IT', 'IT Services', 650000, true, true),
('TCS', 'NSE', 'Tata Consultancy Services Limited', 'IT', 'IT Services', 1200000, true, true),
('WIPRO', 'NSE', 'Wipro Limited', 'IT', 'IT Services', 250000, true, true),
('HDFCBANK', 'NSE', 'HDFC Bank Limited', 'Banking', 'Banks', 850000, true, true),
('ICICIBANK', 'NSE', 'ICICI Bank Limited', 'Banking', 'Banks', 600000, true, true),
('HINDUNILVR', 'NSE', 'Hindustan Unilever Limited', 'FMCG', 'Household & Personal Products', 550000, true, true),
('ITC', 'NSE', 'ITC Limited', 'FMCG', 'Tobacco', 500000, true, true),
('SUNPHARMA', 'NSE', 'Sun Pharmaceutical Industries Limited', 'Pharma', 'Pharmaceuticals', 300000, true, true),
('DRREDDY', 'NSE', 'Dr. Reddy''s Laboratories Limited', 'Pharma', 'Pharmaceuticals', 90000, true, true),
('MARUTI', 'NSE', 'Maruti Suzuki India Limited', 'Auto', 'Automobiles', 300000, true, true);

-- Insert corresponding fundamentals with varied values
INSERT INTO stock_fundamentals (stock_id, pe, pb, roe, roce, debt_to_equity, net_margin, operating_margin, revenue_cr, net_profit_cr, eps, dividend_yield, book_value) VALUES
((SELECT id FROM stocks WHERE symbol = 'INFY'), 25.5, 7.2, 28.5, 35.2, 0.1, 18.5, 22.1, 150000, 27000, 65.5, 2.8, 180.5),
((SELECT id FROM stocks WHERE symbol = 'TCS'), 30.2, 12.5, 45.8, 50.1, 0.05, 22.3, 25.7, 220000, 45000, 120.8, 1.5, 250.3),
((SELECT id FROM stocks WHERE symbol = 'WIPRO'), 22.8, 4.1, 15.2, 18.9, 0.2, 12.4, 15.6, 85000, 9500, 25.4, 1.2, 85.7),
((SELECT id FROM stocks WHERE symbol = 'HDFCBANK'), 18.5, 2.8, 16.8, 7.5, 0.0, 25.6, 30.2, 180000, 38000, 85.2, 1.8, 320.4),
((SELECT id FROM stocks WHERE symbol = 'ICICIBANK'), 20.1, 3.2, 18.9, 8.2, 0.0, 22.1, 28.5, 160000, 32000, 75.6, 1.0, 280.9),
((SELECT id FROM stocks WHERE symbol = 'HINDUNILVR'), 55.3, 10.8, 20.4, 25.7, 0.1, 15.8, 18.9, 60000, 9500, 45.2, 3.5, 150.6),
((SELECT id FROM stocks WHERE symbol = 'ITC'), 28.7, 6.5, 25.1, 30.4, 0.0, 20.3, 24.6, 70000, 14000, 55.8, 2.9, 120.3),
((SELECT id FROM stocks WHERE symbol = 'SUNPHARMA'), 35.6, 4.2, 12.8, 15.6, 0.3, 10.5, 13.2, 45000, 4800, 18.9, 1.5, 75.4),
((SELECT id FROM stocks WHERE symbol = 'DRREDDY'), 19.8, 3.5, 22.4, 25.8, 0.1, 18.7, 21.3, 25000, 4700, 85.6, 2.2, 180.2),
((SELECT id FROM stocks WHERE symbol = 'MARUTI'), 27.4, 4.8, 14.5, 16.9, 0.0, 8.9, 11.2, 120000, 10700, 220.5, 1.8, 450.8);

-- Insert 5 mutual funds: Large Cap, ELSS, Flexi Cap
INSERT INTO mutual_funds (scheme_code, scheme_name, fund_house, category, sub_category, expense_ratio, aum_cr, is_direct, is_growth) VALUES
('118989', 'HDFC Top 100 Fund - Direct Plan - Growth', 'HDFC Mutual Fund', 'Equity', 'Large Cap', 0.5, 25000, true, true),
('120644', 'ICICI Prudential Bluechip Fund - Direct Plan - Growth', 'ICICI Prudential Mutual Fund', 'Equity', 'Large Cap', 0.6, 35000, true, true),
('120465', 'HDFC TaxSaver - Direct Plan - Growth', 'HDFC Mutual Fund', 'Equity', 'ELSS', 0.7, 12000, true, true),
('120466', 'ICICI Prudential Long Term Equity Fund (Tax Saving) - Direct Plan - Growth', 'ICICI Prudential Mutual Fund', 'Equity', 'ELSS', 0.8, 8000, true, true),
('118978', 'HDFC Flexi Cap Fund - Direct Plan - Growth', 'HDFC Mutual Fund', 'Equity', 'Flexi Cap', 0.9, 18000, true, true);