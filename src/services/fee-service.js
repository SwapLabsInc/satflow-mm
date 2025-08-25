const axios = require('axios');

class FeeService {
  static async getRecommendedFees() {
    try {
      console.log('Fetching recommended fees...');
      
      const response = await axios.get(
        'https://memflow.satflow.com/api/v1/fees/recommended',
        {
          headers: {
            'Accept': 'application/json'
          },
          timeout: 10000 // 10 second timeout
        }
      );

      const { fastestFee, halfHourFee, hourFee, economyFee, minimumFee } = response.data;
      
      console.log(`Fee rates - Fastest: ${fastestFee}, Half Hour: ${halfHourFee}, Hour: ${hourFee}, Economy: ${economyFee}, Minimum: ${minimumFee}`);
      
      return {
        fastestFee: fastestFee || 1,
        halfHourFee: halfHourFee || 1,
        hourFee: hourFee || 1,
        economyFee: economyFee || 1,
        minimumFee: minimumFee || 1
      };
    } catch (error) {
      console.error(`Failed to fetch recommended fees: ${error.message}`);
      console.log('Using fallback fee rate of 1');
      
      // Return fallback fee rates
      return {
        fastestFee: 1,
        halfHourFee: 1,
        hourFee: 1,
        economyFee: 1,
        minimumFee: 1
      };
    }
  }

  static async getFastestFee() {
    const fees = await this.getRecommendedFees();
    return fees.fastestFee;
  }
}

module.exports = {
  FeeService
};
