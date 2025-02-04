/*-
 * ========================LICENSE_START=================================
 * Order Dispatcher
 * %%
 * Copyright (C) 2006 - 2022 Amazon Web Services
 * %%
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * =========================LICENSE_END==================================
 */
package com.aws.proto.dispatching.routing;

import com.aws.proto.dispatching.domain.location.ILocation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class DistanceMatrix {
    private static final Logger logger = LoggerFactory.getLogger(DistanceMatrix.class);

    private Map<ILocation, Map<ILocation, Distance>> matrix;
    private long generatedTime;

    private DistanceMatrix(Map<ILocation, Map<ILocation, Distance>> matrix, long generatedTime) {
        this.matrix = matrix;
        this.generatedTime = generatedTime;
    }

    public static <TLocation extends ILocation> DistanceMatrix generate(List<TLocation> locations, GraphhopperRouter router) {
        logger.debug(":: DistanceMatrix :: build with {} locations", locations.size());
        Long start = System.currentTimeMillis();

        DistanceMatrix.Builder builder = new DistanceMatrix.Builder(router);

        for (TLocation location : locations) {
            builder.addLocation(location);
        }

        long generatedTime = System.currentTimeMillis() - start;
        logger.debug(":: DistanceMatrix :: calculation time = {}ms :: dimension = {}", generatedTime, builder.getMatrix().size());
        logger.debug(":: DistanceMatrix :: router errors: {}", router.errors().size());
        router.errors().stream().forEach(logger::info);
        router.clearErrors();

        DistanceMatrix distMatrix = new DistanceMatrix(builder.getMatrix(), generatedTime);
        return distMatrix;
    }

    public Distance distanceBetween(ILocation origin, ILocation destination) {
        Map<ILocation, Distance> distanceRow = matrix.get(origin);
        Distance distance = distanceRow.get(destination);

        return distance;
    }

    public int dimension() {
        return this.matrix.size();
    }

    public long getGeneratedTime() {
        return generatedTime;
    }

    @Override
    public String toString() {
        return "DistanceMatrix{" +
          "matrix=" + matrix +
          '}';
    }

    static class Builder {
        private final IDistanceCalculator distanceCalculator;
        private Map<ILocation, Map<ILocation, Distance>> matrix;

        Builder(IDistanceCalculator distanceCalculator) {
            this.distanceCalculator = distanceCalculator;
            this.matrix = new ConcurrentHashMap<>();
        }

        /**
         * Add a new location into the distance matrix.
         * Calculates all the distances with the existing locations.
         *
         * @param newLocation the new location
         * @return the new calculated distance row
         */
        IDistanceMatrixRow addLocation(ILocation newLocation) {
            logger.trace("Adding location {}", newLocation.coordinates());
            Long start = System.currentTimeMillis();

            Map<ILocation, Distance> distancesToOthers = new ConcurrentHashMap<>();
            distancesToOthers.put(newLocation, Distance.ZERO);

            matrix.entrySet().stream().parallel().forEach(distanceRow -> {
                ILocation other = distanceRow.getKey();
                Map<ILocation, Distance> distancesFromOthers = distanceRow.getValue();
                distancesFromOthers.put(newLocation, calculateDistance(other, newLocation));
                distancesToOthers.put(other, calculateDistance(newLocation, other));
            });

            matrix.put(newLocation, distancesToOthers);
            logger.trace("Location {} added, took {}ms. Current matrix size: {}", newLocation, (System.currentTimeMillis() - start), matrix.size());

            return location -> {
                if (!distancesToOthers.containsKey(location)) {
                    throw new IllegalArgumentException(
                      "Distance from " + newLocation
                        + " to " + location
                        + " hasn't been recorded.\n"
                        + "We only know distances to " + distancesToOthers.keySet());
                }
                return distancesToOthers.get(location);
            };
        }

        /**
         * Calculates the distance between two locations
         *
         * @param origin      origin
         * @param destination destination
         * @return the distance between origin and destination
         */
        private Distance calculateDistance(ILocation origin, ILocation destination) {
            logger.trace("Calculating distance between {},{}\t{},{}", origin.coordinates().getLatitude(), origin.coordinates().getLongitude(), destination.coordinates().getLatitude(), destination.coordinates().getLongitude());
            Distance distance = distanceCalculator.travelDistance(origin.coordinates(), destination.coordinates());
            return distance;
        }

        Map<ILocation, Map<ILocation, Distance>> getMatrix() {
            return this.matrix;
        }
    }
}
